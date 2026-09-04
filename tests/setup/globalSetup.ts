import { execSync, spawn } from 'child_process';
import fs from 'fs';
import { chromium, expect } from '@playwright/test';
import path from 'path';
import { config } from 'dotenv';
import { startTestPostgres } from './postgres';
import globalTeardown from './globalTeardown';
import type { ChildProcess } from 'child_process';
import { startMockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import { startMockS3Server } from '../s3/mockS3Server';
import type { MockS3Server } from '../s3/mockS3Server';

// Load .env.test so test workers (spawned after globalSetup) inherit these vars
config({ path: path.resolve(__dirname, '../../.env.test') });

type GlobalWithServers = typeof globalThis & {
  __SERVER__?: ChildProcess;
  __POSTGRES__?: Awaited<ReturnType<typeof startTestPostgres>>;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

const repoRoot = path.resolve(__dirname, '../..');

async function waitForServer(url: string, server: ChildProcess, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Next.js exited before becoming ready (code=${server.exitCode}, signal=${server.signalCode})`);
    }
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch {
      lastError = 'connection refused';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms (${lastError})`);
}

export default async function globalSetup() {
  try {
    await setup();
  } catch (error) {
    try {
      await globalTeardown();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'E2E setup and cleanup failed');
    }
    throw error;
  }
}

async function setup() {
  // Build the mock provider bundle
  execSync('bun run test:bundle', {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // Start mock OAuth server so its port is known before spawning Next.js.
  const mockOAuth = await startMockOAuthServer();
  process.env.MOCK_OAUTH_PORT = String(mockOAuth.port);
  process.env.GOOGLE_OAUTH_WELL_KNOWN = `http://localhost:${mockOAuth.port}/.well-known/openid-configuration`;
  // Use a stable fake client ID/secret — the mock server accepts any values.
  process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'mock-google-client-secret';
  // Point custom link routes at the mock server instead of Google's production endpoints.
  process.env.GOOGLE_AUTH_URL = `http://localhost:${mockOAuth.port}/auth`;
  process.env.GOOGLE_TOKEN_URL = `http://localhost:${mockOAuth.port}/token`;
  process.env.GOOGLE_USERINFO_URL = `http://localhost:${mockOAuth.port}/userinfo`;
  (globalThis as GlobalWithServers).__MOCK_OAUTH__ = mockOAuth;
  console.log(`Mock OAuth server started on port ${mockOAuth.port}`);

  // Start mock S3 server for file upload tests.
  const mockS3 = await startMockS3Server();
  process.env.AWS_S3_ENDPOINT = `http://127.0.0.1:${mockS3.port}`;
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.AWS_S3_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  (globalThis as GlobalWithServers).__MOCK_S3__ = mockS3;
  console.log(`Mock S3 server started on port ${mockS3.port}`);

  // A fresh, locally owned cluster per run; never use an environment-provided
  // database URL. The app and every Playwright worker inherit this same URL.
  const database = await startTestPostgres();
  (globalThis as GlobalWithServers).__POSTGRES__ = database;
  process.env.DATABASE_URL = database.url;
  execSync('bun x --no-install drizzle-kit migrate', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DRIZZLE_DATABASE_URL: database.url },
  });
  console.log(`Test PostgreSQL ready at ${database.url}`);

  // Where the mailer writes messages it can't send. RESEND_API_KEY is never set
  // in tests, so every email lands here as one JSON line — which is the only
  // way the suite can read a sign-in code: the server stores an HMAC of it, not
  // the code, and runs in a process Playwright doesn't share.
  // Not under test-results/: Playwright wipes its outputDir around the run.
  const mailCapture = path.resolve(repoRoot, '.mail-capture.jsonl');
  fs.writeFileSync(mailCapture, '');
  process.env.MAIL_CAPTURE_PATH = mailCapture;

  // Every test drives a different account from the same loopback address, so
  // the per-IP code quota would fire partway through the run. The per-address
  // limit stays at its real value, and both are unit-tested.
  process.env.EMAIL_CODE_MAX_PER_IP = '100000';

  // Build before starting the server. Running E2E against `next dev` makes the
  // first test that visits each route also compile it. Several workers can hit
  // the same cold route at once, which is exactly the race that used to leave
  // concurrent /tags navigations aborted until the test timeout.
  execSync('bun run build', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
      NEXT_PUBLIC_POSTHOG_HOST: '',
    },
  });

  // Serve the complete, already-built app. Keep the test database and mock
  // service values from the parent process, but use production mode so Next
  // does not run a development compiler or HMR while workers are active.
  let serverOutput = '';
  const server = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'start', '-p', '5005', '--keepAliveTimeout', '120000'],
    {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // Do not let Next's automatic .env.local loading put real analytics
        // credentials into the bundle used by the test browser.
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
        NEXT_PUBLIC_POSTHOG_HOST: '',
      },
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  (globalThis as GlobalWithServers).__SERVER__ = server;

  // Drain the detached child's pipes so it cannot block on a full buffer, but
  // keep email contents and other request logs out of normal test output. If
  // startup fails, include only the recent server output in the setup error.
  const captureServerOutput = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12000);
  };
  server.stdout?.on('data', captureServerOutput);
  server.stderr?.on('data', captureServerOutput);

  try {
    await waitForServer('http://localhost:5005', server);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nNext.js output:\n${serverOutput}`, { cause: error });
  }
  console.log('Next.js production server ready at http://localhost:5005');

  await warmServerEndpoints('http://localhost:5005');
  await warmSignInModal('http://localhost:5005');
}

/** Load the shared server route modules before six workers hit them together. */
async function warmServerEndpoints(baseUrl: string): Promise<void> {
  const paths = [
    '/api/auth/providers',
    '/api/auth/session',
    '/api/auth/callback/google?error=warmup&state=warmup',
    '/api/trpc/notes.list?input=%7B%7D',
  ];

  try {
    await Promise.all(
      paths.map(async (endpoint) => {
        const response = await fetch(`${baseUrl}${endpoint}`, { redirect: 'manual' });
        if (response.status >= 500) throw new Error(`${endpoint} returned HTTP ${response.status}`);
      }),
    );
    console.log('Shared auth and tRPC endpoints warmed');
  } catch (err) {
    // The specs can still exercise a route that did not warm; this is only a
    // startup optimization, not a second health check for the server.
    console.warn('Server endpoint warm-up skipped:', err instanceof Error ? err.message : err);
  }
}

/**
 * Compiles the signed-out page and both lazily-loaded sign-in chunks before any
 * test runs.
 *
 * In dev those chunks are built on first import, and the wallet specs drive
 * RainbowKit's animated modal — which is timing-sensitive enough that a compile
 * happening underneath it leaves the wallet button "not stable" until the test
 * times out. Paying it once here costs a couple of seconds and takes the race
 * away from every spec.
 */
async function warmSignInModal(baseUrl: string): Promise<void> {
  const started = Date.now();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    // The server-rendered button can be clickable before React has attached
    // its handler. Retry the interaction until it opens the modal: waiting
    // for the result of a lost hydration-time click just burns the timeout.
    await expect(async () => {
      if (!(await page.getByTestId('email-sign-in-btn').isVisible())) {
        await page.getByTestId('sign-in-button').first().click({ timeout: 1000 });
      }
      await expect(page.getByTestId('email-sign-in-btn')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000, intervals: [250, 500, 1000] });
    // Both are dynamic imports; waiting on them is what forces the chunks to
    // load before the parallel workers start clicking through the modal.
    await page.getByTestId('email-sign-in-btn').click();
    await page.getByTestId('signin-email-email-input').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('siwe-sign-in-btn').waitFor({ state: 'visible', timeout: 30000 });
    console.log(`Sign-in modal chunks warmed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    // A failed warm-up is not a reason to fail the run; the specs still work,
    // they just pay the compile themselves.
    console.warn('Sign-in modal warm-up skipped:', err instanceof Error ? err.message : err);
  } finally {
    await browser.close();
  }
}

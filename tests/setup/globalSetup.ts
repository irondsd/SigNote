import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import postgres from 'postgres';
import type { ChildProcess } from 'child_process';
import { startMockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import { startMockS3Server } from '../s3/mockS3Server';
import type { MockS3Server } from '../s3/mockS3Server';

// Load .env.test so test workers (spawned after globalSetup) inherit these vars
config({ path: path.resolve(__dirname, '../../.env.test') });

type GlobalWithServers = typeof globalThis & {
  __SERVER__?: ChildProcess;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

// The disposable Postgres from docker-compose (`db-test`, tmpfs-backed).
//
// Deliberately NOT read from DATABASE_URL: this setup truncates every table,
// and DATABASE_URL is the variable that points at Supabase in .env.local.
// Override with TEST_DATABASE_URL, which nothing else in the repo sets.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://signote:signote@localhost:5435/signote_test';

/** Refuse to wipe anything that isn't unmistakably a local test database. */
function assertDisposable(url: string): void {
  const { hostname, pathname } = new URL(url);
  const isLocalHost = ['localhost', '127.0.0.1', '::1', 'db-test'].includes(hostname);
  const isTestDatabase = pathname.replace('/', '').endsWith('_test');
  if (!isLocalHost || !isTestDatabase) {
    throw new Error(
      `Refusing to run E2E against ${hostname}${pathname}: the suite truncates every table. ` +
        'TEST_DATABASE_URL must point at a local database whose name ends in "_test".',
    );
  }
}

async function truncateAll(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables
      where schemaname = 'public' and tablename <> '__drizzle_migrations'`;
    if (tables.length > 0) {
      await sql`truncate table ${sql(tables.map((t) => t.tablename))} cascade`;
    }
  } finally {
    await sql.end();
  }
}

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  // Build the mock provider bundle
  execSync('bun run test:bundle', {
    cwd: path.resolve(__dirname, '../..'),
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

  // Bring up the disposable Postgres and apply migrations to it. Export
  // DATABASE_URL before spawning the web server so it inherits the same one
  // the fixtures write through.
  assertDisposable(TEST_DATABASE_URL);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const repoRoot = path.resolve(__dirname, '../..');

  execSync('docker compose up -d db-test --wait', { cwd: repoRoot, stdio: 'inherit' });
  // DRIZZLE_DATABASE_URL, not DATABASE_URL: drizzle.config.ts loads its env file
  // with `override`, so a plain DATABASE_URL here would lose to .env.local and
  // migrate the dev database instead of this one.
  execSync('npx drizzle-kit migrate', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DRIZZLE_DATABASE_URL: TEST_DATABASE_URL },
  });

  // Each run starts from an empty database — the container is reused between
  // runs, so migrating alone would leave the previous run's rows behind.
  await truncateAll(TEST_DATABASE_URL);
  console.log(`Test Postgres ready at ${TEST_DATABASE_URL}`);

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

  // Spawn Next.js with the current process.env (which now includes DATABASE_URL)
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const server = spawn(npmCommand, ['run', 'dev:test'], {
    env: { ...process.env },
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'ignore',
  });
  (globalThis as GlobalWithServers).__SERVER__ = server;

  await waitForServer('http://localhost:5005');
  console.log('Next.js dev server ready at http://localhost:5005');
}

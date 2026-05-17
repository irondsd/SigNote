import { MongoMemoryServer } from 'mongodb-memory-server';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { config } from 'dotenv';
import type { ChildProcess } from 'child_process';
import { startMockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import { startMockS3Server } from '../s3/mockS3Server';
import type { MockS3Server } from '../s3/mockS3Server';

// Load .env.test so test workers (spawned after globalSetup) inherit these vars
config({ path: path.resolve(__dirname, '../../.env.test') });

type GlobalWithMongo = typeof globalThis & {
  __MONGOD__?: MongoMemoryServer;
  __SERVER__?: ChildProcess;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

async function waitForServer(url: string, timeoutMs = 50000): Promise<void> {
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
  (globalThis as GlobalWithMongo).__MOCK_OAUTH__ = mockOAuth;
  console.log(`Mock OAuth server started on port ${mockOAuth.port}`);

  // Start mock S3 server for file upload tests.
  const mockS3 = await startMockS3Server();
  process.env.AWS_S3_ENDPOINT = `http://127.0.0.1:${mockS3.port}`;
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.AWS_S3_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  (globalThis as GlobalWithMongo).__MOCK_S3__ = mockS3;
  console.log(`Mock S3 server started on port ${mockS3.port}`);

  // Start on a random port and propagate the URI via process.env before
  // spawning the web server, so it inherits the correct MONGODB_URI.
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  (globalThis as GlobalWithMongo).__MONGOD__ = mongod;
  console.log(`MongoMemoryServer started at ${mongod.getUri()}`);

  // Spawn Next.js with the current process.env (which now includes MONGODB_URI)
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const server = spawn(npmCommand, ['run', 'dev:test'], {
    env: { ...process.env },
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'ignore',
  });
  (globalThis as GlobalWithMongo).__SERVER__ = server;

  await waitForServer('http://localhost:5005');
  console.log('Next.js dev server ready at http://localhost:5005');
}

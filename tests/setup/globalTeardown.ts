import type { ChildProcess } from 'child_process';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockS3Server } from '../s3/mockS3Server';
import { closeTestDb } from '../fixtures/db';

type GlobalWithServers = typeof globalThis & {
  __SERVER__?: ChildProcess;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

export default async function globalTeardown() {
  const server = (globalThis as GlobalWithServers).__SERVER__;
  if (server) {
    server.kill('SIGTERM');
    console.log('Next.js server stopped');
  }

  // The Postgres container is left running: it is tmpfs-backed and cheap, and
  // keeping it up makes the next run start much faster. `npm run db:down`
  // removes it.
  await closeTestDb();

  const mockOAuth = (globalThis as GlobalWithServers).__MOCK_OAUTH__;
  if (mockOAuth) {
    await mockOAuth.close();
    console.log('Mock OAuth server stopped');
  }

  const mockS3 = (globalThis as GlobalWithServers).__MOCK_S3__;
  if (mockS3) {
    await mockS3.close();
    console.log('Mock S3 server stopped');
  }
}

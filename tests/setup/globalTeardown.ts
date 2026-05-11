import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { ChildProcess } from 'child_process';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockS3Server } from '../s3/mockS3Server';

type GlobalWithMongo = typeof globalThis & {
  __MONGOD__?: MongoMemoryServer;
  __SERVER__?: ChildProcess;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

export default async function globalTeardown() {
  const server = (globalThis as GlobalWithMongo).__SERVER__;
  if (server) {
    server.kill('SIGTERM');
    console.log('Next.js server stopped');
  }

  const mongod = (globalThis as GlobalWithMongo).__MONGOD__;
  if (mongod) {
    await mongod.stop();
    console.log('MongoMemoryServer stopped');
  }

  const mockOAuth = (globalThis as GlobalWithMongo).__MOCK_OAUTH__;
  if (mockOAuth) {
    await mockOAuth.close();
    console.log('Mock OAuth server stopped');
  }

  const mockS3 = (globalThis as GlobalWithMongo).__MOCK_S3__;
  if (mockS3) {
    await mockS3.close();
    console.log('Mock S3 server stopped');
  }
}

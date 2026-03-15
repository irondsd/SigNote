import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { ChildProcess } from 'child_process';

type GlobalWithMongo = typeof globalThis & {
  __MONGOD__?: MongoMemoryServer;
  __SERVER__?: ChildProcess;
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
}

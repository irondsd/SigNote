import type { MongoMemoryServer } from 'mongodb-memory-server';

type GlobalWithMongo = typeof globalThis & {
  __MONGOD__?: MongoMemoryServer;
};

export default async function globalTeardown() {
  const mongod = (globalThis as GlobalWithMongo).__MONGOD__;
  if (mongod) {
    await mongod.stop();
    console.log('MongoMemoryServer stopped');
  }
}

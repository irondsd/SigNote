import { MongoMemoryServer } from 'mongodb-memory-server';
import { execSync } from 'child_process';
import path from 'path';
import { config } from 'dotenv';

// Load .env.test so test workers (spawned after globalSetup) inherit these vars
config({ path: path.resolve(__dirname, '../../.env.test') });

const MONGO_TEST_PORT = 27018;
type GlobalWithMongo = typeof globalThis & {
  __MONGOD__?: MongoMemoryServer;
};

export default async function globalSetup() {
  // Build the mock provider bundle
  execSync('npm run test:bundle', {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'inherit',
  });

  // Start in-memory MongoDB on a fixed port so .env.test can reference it.
  // globalSetup runs in a separate process from the webServer,
  // so we can't pass the URI via process.env.
  const mongod = await MongoMemoryServer.create({
    instance: { port: MONGO_TEST_PORT },
  });

  // Store for globalTeardown (runs in the same worker process)
  (globalThis as GlobalWithMongo).__MONGOD__ = mongod;

  console.log(`MongoMemoryServer started at ${mongod.getUri()}`);
}

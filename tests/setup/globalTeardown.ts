import { execFile } from 'node:child_process';
import type { startTestPostgres } from './postgres';
import type { ChildProcess } from 'child_process';
import type { MockOAuthServer } from '../oauth/mockOAuthServer';
import type { MockS3Server } from '../s3/mockS3Server';
import { closeTestDb } from '../fixtures/db';

type GlobalWithServers = typeof globalThis & {
  __SERVER__?: ChildProcess;
  __POSTGRES__?: Awaited<ReturnType<typeof startTestPostgres>>;
  __MOCK_OAUTH__?: MockOAuthServer;
  __MOCK_S3__?: MockS3Server;
};

export default async function globalTeardown() {
  const state = globalThis as GlobalWithServers;
  const failures: unknown[] = [];
  const clean = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  };
  const server = state.__SERVER__;
  delete state.__SERVER__;
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    await clean(
      () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (process.platform !== 'win32') {
              try {
                process.kill(-server.pid!, 'SIGKILL');
              } catch {
                /* already exited */
              }
            }
            reject(new Error('Next.js did not stop within 10 seconds'));
          }, 10000);
          server.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          if (process.platform === 'win32') {
            execFile('taskkill', ['/pid', String(server.pid), '/T', '/F'], (error) => {
              if (error) {
                clearTimeout(timer);
                reject(error);
              }
            });
          } else {
            process.kill(-server.pid!, 'SIGTERM');
          }
        }),
    );
  }
  await clean(closeTestDb);
  if (state.__POSTGRES__) {
    const database = state.__POSTGRES__;
    await clean(database.stop);
    delete state.__POSTGRES__;
  }
  if (state.__MOCK_OAUTH__) {
    await clean(() => state.__MOCK_OAUTH__!.close());
    delete state.__MOCK_OAUTH__;
  }
  if (state.__MOCK_S3__) {
    await clean(() => state.__MOCK_S3__!.close());
    delete state.__MOCK_S3__;
  }
  if (failures.length) throw new AggregateError(failures, 'E2E cleanup failed');
}

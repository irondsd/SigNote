import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import postgres from 'postgres';
import { assertPostgresPrepared, postgresBinary } from './postgresRuntime';

const exec = promisify(execFile);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

export async function startTestPostgres() {
  assertPostgresPrepared();
  if (process.getuid?.() === 0) throw new Error('Run E2E as a non-root user: PostgreSQL refuses to run as root.');
  const port = await availablePort();
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'signote-e2e-'));
  const data = path.join(directory, 'data');
  const log = path.join(directory, 'postgres.log');
  const url = `postgres://postgres@127.0.0.1:${port}/signote_test`;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    if (await fs.stat(path.join(data, 'postmaster.pid')).catch(() => null)) {
      await exec(postgresBinary('pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', '15', 'stop'], { timeout: 20000 });
    }
    await fs.rm(directory, { recursive: true, force: true });
    stopped = true;
  };
  try {
    await exec(
      postgresBinary('initdb'),
      ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
      { timeout: 30000 },
    );
    // This cluster is private to the run. Bind only loopback and disable Unix
    // sockets so unrelated local clients cannot discover a default socket.
    await fs.appendFile(
      path.join(data, 'postgresql.conf'),
      `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\n`,
    );
    await exec(postgresBinary('pg_ctl'), ['-D', data, '-l', log, '-w', '-t', '20', 'start'], { timeout: 25000 });
    const sql = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1 });
    try {
      await sql`create database signote_test`;
    } finally {
      await sql.end();
    }
    return { url, stop };
  } catch (error) {
    const details = await fs.readFile(log, 'utf8').catch(() => '');
    await stop();
    throw new Error(`Could not start test PostgreSQL. ${details}`, { cause: error });
  }
}

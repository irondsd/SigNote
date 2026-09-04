import fs from 'node:fs';
import path from 'node:path';

// Binary-only package: installed exclusively by test:e2e:prepare, with lifecycle
// scripts disabled. No PostgreSQL dependency is installed by `bun install`.
export const POSTGRES_VERSION = '18.4.0-beta.17';
export const repoRoot = path.resolve(__dirname, '../..');
const platform = process.platform === 'win32' ? 'windows' : process.platform;
export const postgresPackage = `@embedded-postgres/${platform}-${process.arch}`;
export const runtimeDir = path.join(repoRoot, '.cache/e2e/postgres', `${POSTGRES_VERSION}-${platform}-${process.arch}`);
export const packageDir = path.join(runtimeDir, 'node_modules', postgresPackage);
export const readyFile = path.join(runtimeDir, '.prepared');

export function postgresBinary(name: 'initdb' | 'pg_ctl' | 'postgres'): string {
  return path.join(packageDir, 'native/bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
}

export function assertPostgresPrepared(): void {
  if (!fs.existsSync(readyFile) || !fs.existsSync(postgresBinary('postgres'))) {
    throw new Error('E2E PostgreSQL is not prepared. Run `bun run test:e2e:prepare` first.');
  }
}

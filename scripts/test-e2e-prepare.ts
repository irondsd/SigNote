import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  packageDir,
  postgresBinary,
  postgresPackage,
  POSTGRES_VERSION,
  readyFile,
  repoRoot,
  runtimeDir,
} from '../tests/setup/postgresRuntime';

async function prepare() {
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'];
  if (!supported.includes(postgresPackage.split('/')[1])) {
    throw new Error(`Unsupported E2E PostgreSQL platform: ${process.platform}/${process.arch}`);
  }
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.rm(readyFile, { force: true });
  // An isolated manifest prevents Bun from adding the binary to the app itself.
  await fs.writeFile(
    path.join(runtimeDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        dependencies: { [postgresPackage]: POSTGRES_VERSION },
      },
      null,
      2,
    ) + '\n',
  );
  execFileSync('bun', ['install', '--ignore-scripts'], { cwd: runtimeDir, stdio: 'inherit' });

  // NPM tarballs cannot carry symlinks. Restore the package's link manifest
  // explicitly here, never through a post-install hook.
  const linksPath = path.join(packageDir, 'native/pg-symlinks.json');
  const links: { source: string; target: string }[] = JSON.parse(
    await fs.readFile(linksPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT' && process.platform === 'win32') return '[]';
      throw error;
    }),
  );
  for (const { source, target } of links) {
    const sourcePath = path.resolve(packageDir, source);
    const targetPath = path.resolve(packageDir, target);
    if (![sourcePath, targetPath].every((entry) => entry.startsWith(packageDir + path.sep))) {
      throw new Error('PostgreSQL symlink points outside its package');
    }
    const relativeSource = path.relative(path.dirname(targetPath), sourcePath);
    try {
      await fs.symlink(relativeSource, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await fs.readlink(targetPath)) !== relativeSource)
        throw error;
    }
  }
  for (const name of ['initdb', 'pg_ctl', 'postgres'] as const) {
    if (process.platform !== 'win32') await fs.chmod(postgresBinary(name), 0o755);
    execFileSync(postgresBinary(name), ['--version'], { stdio: 'inherit' });
  }
  await fs.writeFile(readyFile, POSTGRES_VERSION);
  // Same browser used by playwright.config.ts. Forward e.g. --with-deps on CI.
  execFileSync('bun', ['x', '--no-install', 'playwright', 'install', 'chromium', ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  console.log('E2E dependencies ready. Run `bun run test:e2e`.');
}

prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

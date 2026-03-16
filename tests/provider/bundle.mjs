import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';
import * as path from 'path';

const envPath = path.resolve(import.meta.dirname, '../../.env.test');

let rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

if (!rpcUrl) {
  let envContent;
  try {
    await fs.access(envPath);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_RPC_URL is not set in the environment and the test env file "${envPath}" does not exist. ` +
        'Set NEXT_PUBLIC_RPC_URL in your environment or create a .env.test file with this variable.',
    );
  }

  envContent = await fs.readFile(envPath, 'utf8');
  const envEntries = envContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) return null;
      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const unquotedValue =
        rawValue.startsWith('"') && rawValue.endsWith('"')
          ? rawValue.slice(1, -1)
          : rawValue.startsWith("'") && rawValue.endsWith("'")
            ? rawValue.slice(1, -1)
            : rawValue;
      return [key, unquotedValue];
    })
    .filter(Boolean);

  const env = Object.fromEntries(envEntries);
  rpcUrl = env.NEXT_PUBLIC_RPC_URL;

  if (!rpcUrl) {
    throw new Error(
      `NEXT_PUBLIC_RPC_URL is not defined in ${envPath}. ` +
        'Set it in the .env.test file or provide it via the NEXT_PUBLIC_RPC_URL environment variable.',
    );
  }
}

if (rpcUrl === undefined) {
  throw new Error(
    'NEXT_PUBLIC_RPC_URL is not defined in .env.test. ' +
      'Set NEXT_PUBLIC_RPC_URL in tests/.env.test (or ../../.env.test) before running the provider bundle.',
  );
}

const result = await esbuild.build({
  entryPoints: [path.join(import.meta.dirname, 'mock-provider.ts')],
  bundle: true,
  write: false, // We want the output as a string, not a file
  format: 'iife',
  define: {
    'process.env.RPC_URL': JSON.stringify(rpcUrl),
  },
});

const scriptContent = result.outputFiles[0].text;
await fs.writeFile(path.join(import.meta.dirname, 'mock-provider.js'), scriptContent);

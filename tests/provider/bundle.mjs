import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';
import * as path from 'path';

const envPath = path.resolve(import.meta.dirname, '../../.env.test');
const envContent = await fs.readFile(envPath, 'utf8');
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
const rpcUrl = env.NEXT_PUBLIC_RPC_URL;

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

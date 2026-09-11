/** Generates a synthetic-only disposable Vercel fixture outside the application.
 * Never adds fault controls to the Next.js app. Does not deploy automatically.
 * Run with: bun scripts/rotation-transport-fixture.mjs
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const files = {
  'package.json':
    '{"name":"signote-rotation-disposable-spike","private":true,"type":"module","engines":{"node":"24.x"}}\n',
  'vercel.json':
    '{"framework":null,"buildCommand":"","installCommand":"","outputDirectory":null,"regions":["iad1"],"functions":{"api/probe.mjs":{"maxDuration":30}}}\n',
  'api/probe.mjs':
    "// Synthetic-only preview probe. No DB, storage, credentials, or application imports.\nexport default {\n  async fetch(request) {\n    const url = new URL(request.url);\n    const mode = url.searchParams.get('mode') ?? 'metadata';\n    const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };\n    if (mode === 'metadata') return Response.json({ node: process.version, region: process.env.VERCEL_REGION, memoryMb: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE }, { headers });\n    if (mode === 'request' && request.method === 'POST') {\n      const bytes = (await request.arrayBuffer()).byteLength;\n      return Response.json({ bytes }, { headers });\n    }\n    if (mode === 'response') {\n      const bytes = Number(url.searchParams.get('bytes'));\n      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 6_000_000) return new Response('Invalid size', { status: 400, headers });\n      return new Response('x'.repeat(bytes), { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes) } });\n    }\n    if (mode === 'duration') {\n      const ms = Number(url.searchParams.get('ms'));\n      if (!Number.isInteger(ms) || ms < 0 || ms > 35_000) return new Response('Invalid duration', { status: 400, headers });\n      const start = performance.now();\n      await new Promise(resolve => setTimeout(resolve, ms));\n      return Response.json({ elapsedMs: performance.now() - start }, { headers });\n    }\n    return new Response('Not found', { status: 404, headers });\n  }\n};\n",
};
const directory = await mkdtemp(join(tmpdir(), 'signote-rotation-transport-'));
await mkdir(join(directory, 'api'));
for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
process.stdout.write(directory + '\n');

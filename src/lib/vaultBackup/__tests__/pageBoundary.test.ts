import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Export and Import must never hold the MEK, the `deviceShare` or a decrypted
 * vault key — being on a different route is not a boundary by itself, since
 * they share an origin and a bundle. This walks every static import reachable
 * from the two pages and their Workers and fails if any path leads into the
 * vault-key, unlock or decryption modules.
 */

const src = path.resolve(process.cwd(), 'src');
const FORBIDDEN = [
  'lib/crypto.ts',
  'lib/vaultKey.ts',
  'lib/encryptionMaterial.ts',
  'lib/encryptionMaterialStore.ts',
  'contexts/EncryptionContext.tsx',
].map((file) => path.join(src, file));
const ROOTS = [
  'app/(main)/export/page.tsx',
  'app/(main)/import/page.tsx',
  'workers/vaultExport.worker.ts',
  'workers/vaultImport.worker.ts',
].map((file) => path.join(src, file));

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(src, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null; // a package
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ])
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // a directory
      }
    }
  return null;
}

/** Every module reachable from `root`, with the chain that reached it. */
function reachable(root: string) {
  const seen = new Map<string, string[]>([[root, [root]]]);
  const queue = [root];
  while (queue.length) {
    const file = queue.shift()!;
    const source = readFileSync(file, 'utf8')
      // Type-only imports vanish at build time.
      .replace(/import\s+type\s[^;]+;/g, '')
      .replace(/export\s+type\s[^;]+;/g, '');
    for (const match of source.matchAll(IMPORT)) {
      const target = resolve(file, match[1] ?? match[2]);
      if (!target || seen.has(target)) continue;
      seen.set(target, [...seen.get(file)!, target]);
      queue.push(target);
    }
  }
  return seen;
}

it.each(ROOTS.map((root) => [path.relative(src, root), root]))(
  '%s never reaches vault-key or unlock modules',
  (_, root) => {
    const graph = reachable(root);
    expect(graph.size).toBeGreaterThan(1);
    for (const forbidden of FORBIDDEN) {
      const chain = graph.get(forbidden);
      expect(chain?.map((file) => path.relative(src, file)).join(' → ') ?? null).toBeNull();
    }
  },
);

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('sandboxed preload bundle', () => {
  test('contains no local CommonJS imports', () => {
    const source = readFileSync(path.resolve(import.meta.dir, '../dist/preload.js'), 'utf8');

    expect(source).toContain('require("electron")');
    expect(source).not.toMatch(/require\(["']\.{1,2}\//u);
    expect(source).toContain('exposeInMainWorld("signoteDesktop"');
  });
});

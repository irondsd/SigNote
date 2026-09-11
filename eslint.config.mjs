import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'desktop/dist/**',
    'desktop/release/**',
    'next-env.d.ts',
    'tests/provider/mock-provider.js',
    'public/sw.js',
    // Git worktrees the tooling creates in-repo. They hold whole checkouts,
    // build output included, and linting one lints this repo a second time —
    // over files that appear and vanish mid-run.
    '.claude/**',
  ]),
]);

export default eslintConfig;

import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * Which env file supplies DATABASE_URL.
 *
 * Defaults to `.env.local` (the local Docker Postgres), so every bare
 * drizzle-kit command is harmless. The `:prod` npm scripts set this to
 * `.env.prod` explicitly — targeting production is always something you typed.
 */
// An explicit, deliberate target. Nothing auto-loads this name, so it can only
// be here because a caller set it — the E2E harness, or a one-off command.
const explicitUrl = process.env.DRIZZLE_DATABASE_URL;

const envFile = process.env.DRIZZLE_ENV ?? '.env.local';
// `override` matters: the selected file must beat *ambient* DATABASE_URL — the
// .env.local Bun auto-loads, or one exported in the shell. Without it,
// `db:push:prod` silently hits whichever database happened to be in scope.
config({ path: envFile, override: true });

const url = explicitUrl ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(`Missing DATABASE_URL in ${envFile}`);
}

// Say out loud which database is about to be touched — the whole point of the
// local/prod split is that you can never be unsure.
console.log(`drizzle-kit → ${new URL(url).host} (from ${explicitUrl ? 'DRIZZLE_DATABASE_URL' : envFile})`);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
});

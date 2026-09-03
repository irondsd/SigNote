-- Close the PostgREST surface on the public schema.
--
-- Supabase exposes `public` through PostgREST, and its bootstrap grants full
-- CRUD on every table to `anon` and `authenticated`. The `anon` role is reached
-- with the project's anon key, which is designed to be published in client
-- code — so without this, anyone holding that key can read or delete every
-- note, user, session and encryption profile, entirely bypassing the app.
--
-- This app never uses PostgREST; it connects directly with a password as the
-- table owner. So the fix is to remove the surface rather than write policies:
--
--   1. RLS on, with NO policies → default-deny for anon/authenticated.
--      Safe for the app: the owner (and any role with BYPASSRLS) is exempt.
--      Do NOT add FORCE ROW LEVEL SECURITY — that would subject the owner to
--      the same default-deny and take the application down.
--   2. Revoke the grants outright, so the tables are unreachable even if the
--      schema is re-exposed later.
--
-- `service_role` is deliberately left alone: it requires the service key, which
-- is a genuine secret, and it is what Supabase's own tooling uses.
--
-- Steps 2 and 3 are guarded on the roles existing, so this migration is a
-- no-op on local Docker/PGlite, where anon and authenticated are not defined.

-- 1. Default-deny for every non-owner role.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. Remove the PostgREST roles' existing privileges.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
  END IF;
END $$;
--> statement-breakpoint

-- 3. Stop Supabase's default privileges from re-granting on the next table this
--    role creates — otherwise every future migration silently reopens the hole.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;

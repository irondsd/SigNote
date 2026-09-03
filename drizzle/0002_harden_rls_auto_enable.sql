-- Harden the auto-RLS event trigger, and bring it under version control.
--
-- `rls_auto_enable()` enables RLS on any table created in `public`, so a new
-- table can never ship without it. It was added directly on production, which
-- meant (a) it existed nowhere else, and (b) it tripped two Supabase linter
-- errors: SECURITY DEFINER functions should not be callable by `anon` or
-- `authenticated`, and should pin their search_path.
--
-- Calling it directly is harmless — `pg_event_trigger_ddl_commands()` errors
-- outside an event-trigger context — but there is no reason for those roles to
-- hold EXECUTE, and an unpinned search_path on a SECURITY DEFINER function
-- owned by a BYPASSRLS role is worth closing on principle.
--
-- Defining it here as well keeps local, test and production identical: the
-- safety net now survives a rebuild from migrations.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
DECLARE cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$fn$;
--> statement-breakpoint

-- Nothing should call this by hand; the event trigger runs it as the owner.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint

-- Attach the trigger where it doesn't exist yet (production already has it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  -- Event triggers need superuser; skip rather than fail the migration.
  RAISE NOTICE 'rls_auto_enable: no privilege to create the event trigger, skipping';
END $$;

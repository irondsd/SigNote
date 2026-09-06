CREATE TABLE "otp_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"position" double precision NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"color" text,
	"pattern" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "otp_records_user_idx" ON "otp_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_records_deleted_idx" ON "otp_records" USING btree ("deleted_at");
--> statement-breakpoint

-- Added by hand to the generated file, as in 0003 and 0005: drizzle-kit does
-- not model RLS, and the `ensure_rls` event trigger from 0002 is only a safety
-- net — its installation is skipped on `insufficient_privilege`. The table is
-- default-deny with no policies; `anon`/`authenticated` have no grants, and
-- 0001 fixed ALTER DEFAULT PRIVILEGES so a new table is not silently re-granted.
--
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`: the application connects as the
-- table owner, which is exempt from RLS, so forcing it would default-deny the
-- application itself. Ownership checks in controllers/otpRecords.ts remain the
-- real authorization boundary; this is defence in depth against PostgREST.
ALTER TABLE "otp_records" ENABLE ROW LEVEL SECURITY;

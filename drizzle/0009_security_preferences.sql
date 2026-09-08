CREATE TABLE "security_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cache_server_share" boolean DEFAULT false NOT NULL,
	"blur_auth_codes" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "security_preferences_user_unique" ON "security_preferences" USING btree ("user_id");
--> statement-breakpoint
-- Added by hand to the generated file: drizzle-kit doesn't model RLS, and the
-- `rls_auto_enable` event trigger that would otherwise cover this only exists
-- where 0002 has been applied. Every table in `public` must have RLS on — the
-- app connects as the owner, which is exempt, so this costs nothing and the
-- Supabase linter flags its absence as an error.
ALTER TABLE "security_preferences" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_news" boolean DEFAULT true NOT NULL,
	"sign_in_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_unique" ON "notification_preferences" USING btree ("user_id");
--> statement-breakpoint
-- Added by hand to the generated file: drizzle-kit doesn't model RLS, and the
-- `rls_auto_enable` event trigger that would otherwise cover this only exists
-- where 0002 has been applied. Every table in `public` must have RLS on — the
-- app connects as the owner, which is exempt, so this costs nothing and the
-- Supabase linter flags its absence as an error.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

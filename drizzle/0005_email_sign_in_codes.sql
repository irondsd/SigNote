CREATE TABLE "email_sign_in_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_sign_in_codes_email_idx" ON "email_sign_in_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_sign_in_codes_expires_idx" ON "email_sign_in_codes" USING btree ("expires_at");--> statement-breakpoint

-- Added by hand to the generated file, as in 0003: drizzle-kit doesn't model
-- RLS, and the `rls_auto_enable` event trigger that would otherwise cover this
-- only exists where 0002 has been applied.
ALTER TABLE "email_sign_in_codes" ENABLE ROW LEVEL SECURITY;

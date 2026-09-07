CREATE TABLE "passkey_challenges" (
	"challenge" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"ip" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aaguid" text NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"nickname" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "passkey_challenges_ip_created_idx" ON "passkey_challenges" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "passkey_challenges_expires_idx" ON "passkey_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_credential_unique" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint

-- drizzle-kit does not model RLS, and the ensure_rls event trigger can be
-- unavailable on providers that do not grant event-trigger privileges. Keep
-- both new tables default-deny to PostgREST without forcing RLS on the owner.
ALTER TABLE "passkey_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "auth_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"email_verified" boolean,
	"last_login_at" timestamp with time zone NOT NULL,
	"raw_profile_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"client" text DEFAULT 'web' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"browser" text DEFAULT '' NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"device_type" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "desktop_auth_attempts" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"authorization_code_hash" text,
	"user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"exchange_attempts" integer DEFAULT 0 NOT NULL,
	"authorized_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encryption_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"server_share" text NOT NULL,
	"salt" text NOT NULL,
	"kdf" jsonb NOT NULL,
	"key_check" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"note_id" text,
	"note_tier" text,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"encryption_iv" text,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"storage_deleted_at" timestamp with time zone,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"last_delete_error" text
);
--> statement-breakpoint
CREATE TABLE "note_tags" (
	"note_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "note_versions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"note_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"color" text,
	"pattern" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"burn_after_reading" boolean DEFAULT false NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "seal_note_tags" (
	"note_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seal_note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "seal_note_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "seal_note_versions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"note_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"encrypted_body" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seal_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"color" text,
	"pattern" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"burn_after_reading" boolean DEFAULT false NOT NULL,
	"encrypted_body" jsonb,
	"wrapped_note_key" jsonb,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A')) STORED
);
--> statement-breakpoint
CREATE TABLE "secret_note_tags" (
	"note_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "secret_note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "secret_note_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "secret_note_versions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"note_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"encrypted_body" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"color" text,
	"pattern" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"burn_after_reading" boolean DEFAULT false NOT NULL,
	"encrypted_body" jsonb,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A')) STORED
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_note_tags" ADD CONSTRAINT "seal_note_tags_note_id_seal_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."seal_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_note_tags" ADD CONSTRAINT "seal_note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_note_versions" ADD CONSTRAINT "seal_note_versions_note_id_seal_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."seal_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_note_tags" ADD CONSTRAINT "secret_note_tags_note_id_secret_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."secret_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_note_tags" ADD CONSTRAINT "secret_note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_note_versions" ADD CONSTRAINT "secret_note_versions_note_id_secret_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."secret_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_unique" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_nonces_ip_created_idx" ON "auth_nonces" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_updated_idx" ON "auth_sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "desktop_auth_attempts_ip_created_idx" ON "desktop_auth_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "desktop_auth_attempts_expires_idx" ON "desktop_auth_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_auth_attempts_code_unique" ON "desktop_auth_attempts" USING btree ("authorization_code_hash") WHERE "desktop_auth_attempts"."authorization_code_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "encryption_profiles_user_unique" ON "encryption_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_attachments_user_idx" ON "file_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_attachments_note_idx" ON "file_attachments" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "file_attachments_storage_deleted_idx" ON "file_attachments" USING btree ("storage_deleted_at");--> statement-breakpoint
CREATE INDEX "note_tags_tag_idx" ON "note_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "note_versions_note_idx" ON "note_versions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_user_deleted_idx" ON "notes" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "notes_list_idx" ON "notes" USING btree ("user_id","archived","pinned","position");--> statement-breakpoint
CREATE INDEX "notes_search_sort_idx" ON "notes" USING btree ("user_id","archived","pinned","updated_at");--> statement-breakpoint
CREATE INDEX "notes_expires_idx" ON "notes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "notes_deleted_idx" ON "notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "notes_search_tsv_idx" ON "notes" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "seal_note_tags_tag_idx" ON "seal_note_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "seal_note_versions_note_idx" ON "seal_note_versions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "seal_notes_user_deleted_idx" ON "seal_notes" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "seal_notes_list_idx" ON "seal_notes" USING btree ("user_id","archived","pinned","position");--> statement-breakpoint
CREATE INDEX "seal_notes_search_sort_idx" ON "seal_notes" USING btree ("user_id","archived","pinned","updated_at");--> statement-breakpoint
CREATE INDEX "seal_notes_expires_idx" ON "seal_notes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "seal_notes_deleted_idx" ON "seal_notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "seal_notes_search_tsv_idx" ON "seal_notes" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "secret_note_tags_tag_idx" ON "secret_note_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "secret_note_versions_note_idx" ON "secret_note_versions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_notes_user_deleted_idx" ON "secret_notes" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "secret_notes_list_idx" ON "secret_notes" USING btree ("user_id","archived","pinned","position");--> statement-breakpoint
CREATE INDEX "secret_notes_search_sort_idx" ON "secret_notes" USING btree ("user_id","archived","pinned","updated_at");--> statement-breakpoint
CREATE INDEX "secret_notes_expires_idx" ON "secret_notes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "secret_notes_deleted_idx" ON "secret_notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "secret_notes_search_tsv_idx" ON "secret_notes" USING gin ("search_tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_unique" ON "tags" USING btree ("user_id","name");
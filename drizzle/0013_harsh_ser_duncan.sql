ALTER TABLE "file_attachments" ADD COLUMN "key_scope" text DEFAULT 'vault' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD COLUMN "key_note_id" text;
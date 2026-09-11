CREATE TABLE "encryption_rotations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner_sid" text NOT NULL,
	"worker_fence" integer DEFAULT 1 NOT NULL,
	"source_generation" integer NOT NULL,
	"target_generation" integer NOT NULL,
	"profile_id" text NOT NULL,
	"profile_digest" text NOT NULL,
	"begin_digest" text NOT NULL,
	"phase" text DEFAULT 'preparing' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"pending_material" jsonb,
	"inventory_digest" text NOT NULL,
	"item_count" integer NOT NULL,
	"source_bytes" bigint NOT NULL,
	"file_bytes" bigint NOT NULL,
	"staged_bytes" bigint DEFAULT 0 NOT NULL,
	"recovery_digest" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "encryption_rotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "encryption_states" (
	"user_id" text PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"session_epoch" integer DEFAULT 0 NOT NULL,
	"surviving_sid" text,
	"active_rotation_id" text
);
--> statement-breakpoint
ALTER TABLE "encryption_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rotation_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"object_key" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rotation_cleanup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rotation_items" (
	"operation_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"parent_id" text,
	"source_digest" text NOT NULL,
	"source" jsonb,
	"replacement" jsonb,
	"replacement_digest" text,
	"verified_digest" text,
	"stage_key" text,
	"staged_bytes" integer DEFAULT 0 NOT NULL,
	"file_grant" jsonb,
	"grant_expires_at" timestamp with time zone,
	"file_verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rotation_items_operation_id_kind_resource_id_pk" PRIMARY KEY("operation_id","kind","resource_id")
);
--> statement-breakpoint
ALTER TABLE "rotation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rotation_cleanup" ADD CONSTRAINT "rotation_cleanup_operation_id_encryption_rotations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."encryption_rotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_items" ADD CONSTRAINT "rotation_items_operation_id_encryption_rotations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."encryption_rotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encryption_rotations_user_idx" ON "encryption_rotations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encryption_rotations_one_active" ON "encryption_rotations" USING btree ("user_id") WHERE "encryption_rotations"."phase" in ('preparing', 'migrating', 'ready');--> statement-breakpoint
CREATE INDEX "encryption_rotations_expiry_idx" ON "encryption_rotations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_cleanup_object_unique" ON "rotation_cleanup" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "rotation_cleanup_due_idx" ON "rotation_cleanup" USING btree ("not_before");
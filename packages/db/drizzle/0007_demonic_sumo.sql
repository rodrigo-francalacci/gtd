CREATE TYPE "public"."review_step" AS ENUM('inbox', 'projects', 'stalled', 'waiting', 'standby', 'done');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"step" "review_step" DEFAULT 'inbox' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reviews_completed_idx" ON "reviews" USING btree ("completed_at");
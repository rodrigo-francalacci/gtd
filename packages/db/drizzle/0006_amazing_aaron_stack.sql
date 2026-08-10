CREATE TYPE "public"."inbox_outcome" AS ENUM('next_action', 'waiting', 'project', 'list_item', 'done', 'trashed');--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "outcome" "inbox_outcome";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "outcome_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "clarified_at" timestamp with time zone;
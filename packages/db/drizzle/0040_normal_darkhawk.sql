CREATE TYPE "public"."box_event_kind" AS ENUM('started', 'concluded');--> statement-breakpoint
ALTER TYPE "public"."box_item_kind" ADD VALUE 'event';--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "event" "box_event_kind";--> statement-breakpoint
ALTER TABLE "box_items" ADD CONSTRAINT "box_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
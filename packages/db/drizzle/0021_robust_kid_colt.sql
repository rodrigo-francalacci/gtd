CREATE TYPE "public"."box_item_kind" AS ENUM('document', 'note', 'location');--> statement-breakpoint
ALTER TABLE "box_items" ALTER COLUMN "drive_file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "box_items" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "kind" "box_item_kind" DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "lng" double precision;
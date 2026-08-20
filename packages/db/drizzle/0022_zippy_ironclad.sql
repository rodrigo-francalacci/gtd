ALTER TYPE "public"."box_item_kind" ADD VALUE 'link';--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "image_url" text;
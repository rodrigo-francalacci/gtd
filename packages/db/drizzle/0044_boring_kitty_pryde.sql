ALTER TYPE "public"."attachment_kind" ADD VALUE 'gallery';--> statement-breakpoint
ALTER TYPE "public"."attachment_parent_type" ADD VALUE 'gallery';--> statement-breakpoint
ALTER TYPE "public"."box_item_kind" ADD VALUE 'gallery' BEFORE 'event';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "longitude" double precision;
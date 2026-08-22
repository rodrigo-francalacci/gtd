ALTER TYPE "public"."inbox_outcome" ADD VALUE 'filed';--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "expires_at" date;
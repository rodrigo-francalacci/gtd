ALTER TABLE "attachments" ADD COLUMN "typeset_file_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "typeset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "typeset_file_id" text;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "typeset_at" timestamp with time zone;
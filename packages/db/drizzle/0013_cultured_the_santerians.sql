ALTER TABLE "attachments" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "size_bytes" integer;
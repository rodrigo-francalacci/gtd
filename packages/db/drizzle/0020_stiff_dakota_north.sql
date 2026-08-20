ALTER TABLE "boxes" ADD COLUMN "rules" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "box_view" text;
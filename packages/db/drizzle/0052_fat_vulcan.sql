ALTER TABLE "box_items" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE INDEX "box_items_source_idx" ON "box_items" USING btree ("source_id");
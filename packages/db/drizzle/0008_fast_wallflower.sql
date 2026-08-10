ALTER TABLE "inbox_items" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(raw_text, ''))) STORED;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED;--> statement-breakpoint
CREATE INDEX "inbox_items_search_idx" ON "inbox_items" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "list_items_search_idx" ON "list_items" USING gin ("search_vector");
-- Hand-ordered. drizzle-kit emitted the recreated generated column *before*
-- the column it reads, so `search_text` did not exist yet and the statement
-- failed. The plain columns have to land first.
ALTER TABLE "list_items" ADD COLUMN "notes" jsonb;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "search_text" text;--> statement-breakpoint
-- Dropping the column takes its GIN index with it, so both are rebuilt below.
ALTER TABLE "list_items" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(search_text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "list_items_search_idx" ON "list_items" USING gin ("search_vector");

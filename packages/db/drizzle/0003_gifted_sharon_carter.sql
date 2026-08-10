ALTER TABLE "list_items" ADD COLUMN "position" double precision;--> statement-breakpoint
CREATE INDEX "list_items_position_idx" ON "list_items" USING btree ("position");--> statement-breakpoint
--> Backfill per list, in creation order. Unlike actions these never appear in a
--> combined cross-list view, so per-list sequences don't interleave anywhere.
UPDATE "list_items" li
SET "position" = r.rn
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "list_id" ORDER BY "created_at"
  ) * 1000 AS rn
  FROM "list_items"
) r
WHERE li."id" = r."id" AND li."position" IS NULL;
ALTER TABLE "actions" ADD COLUMN "position" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "position" double precision;--> statement-breakpoint
CREATE INDEX "actions_position_idx" ON "actions" USING btree ("position");--> statement-breakpoint
CREATE INDEX "projects_position_idx" ON "projects" USING btree ("position");--> statement-breakpoint
--> Backfill: seed positions from creation order so existing rows sort the way
--> they already appeared, instead of falling to the end as nulls.
UPDATE "actions" a
SET "position" = r.rn
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY coalesce("project_id"::text, '') ORDER BY "created_at"
  ) * 1000 AS rn
  FROM "actions"
) r
WHERE a."id" = r."id" AND a."position" IS NULL;--> statement-breakpoint
UPDATE "projects" p
SET "position" = r.rn
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "status" ORDER BY "title"
  ) * 1000 AS rn
  FROM "projects"
) r
WHERE p."id" = r."id" AND p."position" IS NULL;
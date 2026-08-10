ALTER TABLE "projects" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "projects_completed_at_idx" ON "projects" USING btree ("completed_at");--> statement-breakpoint
--> Backfill already-finished projects. `updated_at` is the best evidence we
--> have of when they were closed — imprecise, but better than a null that
--> would drop them out of a date-sorted archive entirely.
UPDATE "projects"
SET "completed_at" = "updated_at"
WHERE "status" IN ('completed', 'dropped') AND "completed_at" IS NULL;
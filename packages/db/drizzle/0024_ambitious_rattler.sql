DROP INDEX "actions_use_count_idx";--> statement-breakpoint
DROP INDEX "inbox_items_use_count_idx";--> statement-breakpoint
DROP INDEX "list_items_use_count_idx";--> statement-breakpoint
DROP INDEX "projects_use_count_idx";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "use_count";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "last_used_at";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "use_count";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "last_used_at";--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "use_count";--> statement-breakpoint
ALTER TABLE "list_items" DROP COLUMN "last_used_at";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "use_count";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "last_used_at";
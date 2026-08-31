ALTER TYPE "public"."sync_job_kind" ADD VALUE 'move_box_file';--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "box_item_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_box_item_id_box_items_id_fk" FOREIGN KEY ("box_item_id") REFERENCES "public"."box_items"("id") ON DELETE cascade ON UPDATE no action;
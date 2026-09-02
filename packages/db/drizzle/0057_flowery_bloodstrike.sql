ALTER TYPE "public"."sync_job_kind" ADD VALUE 'move_action_folder';--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "action_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;
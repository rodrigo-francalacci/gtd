ALTER TYPE "public"."sync_job_kind" ADD VALUE 'move_attachment';--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;
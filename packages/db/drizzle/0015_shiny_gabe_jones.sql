CREATE TYPE "public"."enrichment_job_kind" AS ENUM('ocr', 'transcribe');--> statement-breakpoint
CREATE TABLE "enrichment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "enrichment_job_kind" NOT NULL,
	"attachment_id" uuid NOT NULL,
	"status" "sync_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_jobs_status_idx" ON "enrichment_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "enrichment_jobs_attachment_idx" ON "enrichment_jobs" USING btree ("attachment_id");
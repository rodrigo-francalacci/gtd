ALTER TABLE "email_requests" ADD COLUMN "parent_type" "attachment_parent_type";--> statement-breakpoint
ALTER TABLE "email_requests" ADD COLUMN "parent_id" uuid;
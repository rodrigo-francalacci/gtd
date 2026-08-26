CREATE TYPE "public"."email_request_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "email_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" "email_request_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"filed" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_requests" ADD CONSTRAINT "email_requests_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_requests_status_idx" ON "email_requests" USING btree ("status","created_at");
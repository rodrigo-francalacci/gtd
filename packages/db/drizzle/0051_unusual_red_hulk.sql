CREATE TABLE "now_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_section_id_now_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."now_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_section_idx" ON "actions" USING btree ("section_id");
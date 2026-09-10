CREATE TABLE "box_tag_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"suggestions" jsonb NOT NULL,
	"read_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_tag_suggestions_box_id_unique" UNIQUE("box_id")
);
--> statement-breakpoint
ALTER TABLE "box_tag_suggestions" ADD CONSTRAINT "box_tag_suggestions_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;
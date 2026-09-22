CREATE TABLE "box_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"name" text NOT NULL,
	"drive_folder_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "box_folders" ADD CONSTRAINT "box_folders_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_folders_box_idx" ON "box_folders" USING btree ("box_id");--> statement-breakpoint
CREATE UNIQUE INDEX "box_folders_unique_idx" ON "box_folders" USING btree ("box_id",lower("name"));--> statement-breakpoint
ALTER TABLE "box_items" ADD CONSTRAINT "box_items_folder_id_box_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."box_folders"("id") ON DELETE set null ON UPDATE no action;
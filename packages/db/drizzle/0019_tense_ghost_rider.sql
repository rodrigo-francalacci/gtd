CREATE TYPE "public"."box_item_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "box_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"name" text NOT NULL,
	"allow_new_tags" boolean DEFAULT false NOT NULL,
	"position" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_item_links" (
	"item_id" uuid NOT NULL,
	"parent_type" "attachment_parent_type" NOT NULL,
	"parent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_item_links_item_id_parent_type_parent_id_pk" PRIMARY KEY("item_id","parent_type","parent_id")
);
--> statement-breakpoint
CREATE TABLE "box_item_tags" (
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "box_item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "box_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"drive_file_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"title" text,
	"description" text,
	"doc_date" date,
	"text" text,
	"status" "box_item_status" DEFAULT 'pending' NOT NULL,
	"search_text" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(search_text, ''))) STORED,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "sync_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "box_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"drive_folder_id" text,
	"instruction" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "box_categories" ADD CONSTRAINT "box_categories_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_item_links" ADD CONSTRAINT "box_item_links_item_id_box_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."box_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_item_tags" ADD CONSTRAINT "box_item_tags_item_id_box_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."box_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_item_tags" ADD CONSTRAINT "box_item_tags_tag_id_box_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."box_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_items" ADD CONSTRAINT "box_items_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_jobs" ADD CONSTRAINT "box_jobs_item_id_box_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."box_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_tags" ADD CONSTRAINT "box_tags_category_id_box_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."box_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_categories_box_idx" ON "box_categories" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_item_links_parent_idx" ON "box_item_links" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "box_item_tags_tag_idx" ON "box_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "box_items_box_idx" ON "box_items" USING btree ("box_id","captured_at");--> statement-breakpoint
CREATE INDEX "box_items_drive_idx" ON "box_items" USING btree ("drive_file_id");--> statement-breakpoint
CREATE INDEX "box_items_search_idx" ON "box_items" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "box_jobs_status_idx" ON "box_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "box_jobs_item_idx" ON "box_jobs" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "box_tags_category_idx" ON "box_tags" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "box_tags_unique_idx" ON "box_tags" USING btree ("category_id",lower("name"));--> statement-breakpoint
CREATE INDEX "boxes_default_idx" ON "boxes" USING btree ("is_default");
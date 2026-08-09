CREATE TYPE "public"."action_status" AS ENUM('next', 'waiting', 'done');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('image', 'audio', 'link', 'file');--> statement-breakpoint
CREATE TYPE "public"."attachment_parent_type" AS ENUM('project', 'action', 'list_item');--> statement-breakpoint
CREATE TYPE "public"."context_dimension" AS ENUM('place', 'time', 'energy', 'person');--> statement-breakpoint
CREATE TYPE "public"."inbox_raw_type" AS ENUM('text', 'photo', 'audio');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'clarified');--> statement-breakpoint
CREATE TYPE "public"."list_type" AS ENUM('someday_maybe', 'purchases', 'reference', 'checklist');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'standby', 'someday', 'completed', 'dropped');--> statement-breakpoint
CREATE TABLE "action_contexts" (
	"action_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	CONSTRAINT "action_contexts_action_id_context_id_pk" PRIMARY KEY("action_id","context_id")
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"status" "action_status" DEFAULT 'next' NOT NULL,
	"waiting_since" date,
	"completed_at" timestamp with time zone,
	"notes" jsonb,
	"search_text" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(search_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "areas_of_focus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" "attachment_parent_type" NOT NULL,
	"parent_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"drive_file_id" text,
	"transcription" text,
	"ocr_text" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(transcription, '') || ' ' || coalesce(ocr_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dimension" "context_dimension" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid,
	"title" text NOT NULL,
	"target_date" date,
	"notes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_type" "inbox_raw_type" NOT NULL,
	"drive_file_id" text,
	"raw_text" text,
	"ai_suggestion" jsonb,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"title" text NOT NULL,
	"fields" jsonb,
	"project_id" uuid,
	"promoted_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "list_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area_id" uuid,
	"goal_id" uuid,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"standby_reason" text,
	"drive_folder_id" text,
	"gmail_label_id" text,
	"notes" jsonb,
	"search_text" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(search_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_contexts" ADD CONSTRAINT "action_contexts_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_contexts" ADD CONSTRAINT "action_contexts_context_id_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_area_id_areas_of_focus_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas_of_focus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_promoted_action_id_actions_id_fk" FOREIGN KEY ("promoted_action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_area_id_areas_of_focus_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas_of_focus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_contexts_context_idx" ON "action_contexts" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "actions_project_idx" ON "actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "actions_status_idx" ON "actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "actions_waiting_since_idx" ON "actions" USING btree ("waiting_since");--> statement-breakpoint
CREATE INDEX "actions_search_idx" ON "actions" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "attachments_parent_idx" ON "attachments" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "attachments_search_idx" ON "attachments" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "contexts_dimension_idx" ON "contexts" USING btree ("dimension");--> statement-breakpoint
CREATE INDEX "goals_area_idx" ON "goals" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "list_items_project_idx" ON "list_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_area_idx" ON "projects" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "projects_goal_idx" ON "projects" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "projects_search_idx" ON "projects" USING gin ("search_vector");
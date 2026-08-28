CREATE TABLE "project_trees" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"drive" jsonb,
	"gmail" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "project_trees" ADD CONSTRAINT "project_trees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
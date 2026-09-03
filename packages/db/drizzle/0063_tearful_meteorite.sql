CREATE TABLE "folder_trees" (
	"folder_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"tree" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);

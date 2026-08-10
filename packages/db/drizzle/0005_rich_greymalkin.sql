CREATE TABLE "preferences" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"list_pane_width" integer,
	"view_mode" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

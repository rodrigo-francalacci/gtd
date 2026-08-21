CREATE TABLE "view_prefs" (
	"key" text PRIMARY KEY NOT NULL,
	"sort" text,
	"descending" boolean DEFAULT false NOT NULL,
	"grouped" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "box_items" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "actions_use_count_idx" ON "actions" USING btree ("use_count");--> statement-breakpoint
CREATE INDEX "attachments_use_count_idx" ON "attachments" USING btree ("use_count");--> statement-breakpoint
CREATE INDEX "box_items_use_count_idx" ON "box_items" USING btree ("use_count");--> statement-breakpoint
CREATE INDEX "inbox_items_use_count_idx" ON "inbox_items" USING btree ("use_count");--> statement-breakpoint
CREATE INDEX "list_items_use_count_idx" ON "list_items" USING btree ("use_count");--> statement-breakpoint
CREATE INDEX "projects_use_count_idx" ON "projects" USING btree ("use_count");
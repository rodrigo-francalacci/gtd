CREATE TABLE "box_days" (
	"box_id" uuid NOT NULL,
	"day" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(note, ''))) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_days_box_id_day_pk" PRIMARY KEY("box_id","day")
);
--> statement-breakpoint
ALTER TABLE "box_days" ADD CONSTRAINT "box_days_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_days_search_idx" ON "box_days" USING gin ("search_vector");
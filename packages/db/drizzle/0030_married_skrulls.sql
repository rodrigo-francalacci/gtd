ALTER TABLE "box_days" DROP CONSTRAINT "box_days_box_id_boxes_id_fk";
--> statement-breakpoint
ALTER TABLE "box_days" DROP CONSTRAINT "box_days_box_id_day_pk";--> statement-breakpoint
-- A day's note is now one note, so two boxes describing the same Tuesday
-- would collide on the new key. Keep the most recently written and drop the
-- rest, which is the only merge that does not invent an answer.
DELETE FROM "box_days" a
 USING "box_days" b
 WHERE a."day" = b."day"
   AND (a."updated_at", a."box_id") < (b."updated_at", b."box_id");--> statement-breakpoint
ALTER TABLE "box_days" ADD PRIMARY KEY ("day");--> statement-breakpoint
ALTER TABLE "view_prefs" ADD COLUMN "density" text;--> statement-breakpoint
ALTER TABLE "box_days" DROP COLUMN "box_id";
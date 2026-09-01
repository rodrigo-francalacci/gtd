ALTER TABLE "box_items" DROP CONSTRAINT "box_items_labelled_box_id_boxes_id_fk";
--> statement-breakpoint
ALTER TABLE "box_items" DROP COLUMN "labelled_box_id";
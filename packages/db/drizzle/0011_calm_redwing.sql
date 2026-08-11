ALTER TABLE "actions" ADD COLUMN "waiting_on_id" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_waiting_on_id_contexts_id_fk" FOREIGN KEY ("waiting_on_id") REFERENCES "public"."contexts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_waiting_on_idx" ON "actions" USING btree ("waiting_on_id");
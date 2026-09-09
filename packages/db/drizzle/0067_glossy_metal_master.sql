ALTER TABLE "actions" ADD COLUMN "blocked_by" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_blocked_by_actions_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_blocked_idx" ON "actions" USING btree ("blocked_by");
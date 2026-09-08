ALTER TABLE "actions" ADD COLUMN "defer_until" date;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "scheduled_end" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "actions_defer_idx" ON "actions" USING btree ("defer_until");--> statement-breakpoint
CREATE INDEX "actions_scheduled_idx" ON "actions" USING btree ("scheduled_at");
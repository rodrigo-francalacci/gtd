CREATE TABLE "ai_prices" (
	"model" text PRIMARY KEY NOT NULL,
	"input_per_million" double precision NOT NULL,
	"cached_per_million" double precision DEFAULT 0 NOT NULL,
	"output_per_million" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" double precision NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "ai_spend_at_idx" ON "ai_spend" USING btree ("at");
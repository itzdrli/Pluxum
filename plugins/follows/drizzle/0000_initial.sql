CREATE TABLE "follow_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notify" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_target_kind_target_id_pk" PRIMARY KEY("follower_id","target_kind","target_id")
);
--> statement-breakpoint
CREATE INDEX "follows_target_idx" ON "follows" USING btree ("target_kind","target_id");
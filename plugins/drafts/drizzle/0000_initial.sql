CREATE TABLE "drafts" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE INDEX "drafts_user_updated_idx" ON "drafts" USING btree ("user_id","updated_at");
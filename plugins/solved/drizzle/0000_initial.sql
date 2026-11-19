CREATE TABLE "solutions" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"post_number" integer NOT NULL,
	"answer_author_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "solutions_post_idx" ON "solutions" USING btree ("post_id");
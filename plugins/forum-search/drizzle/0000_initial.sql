CREATE TABLE "search_documents" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"opening" boolean NOT NULL,
	"title" text NOT NULL,
	"plain_body" text NOT NULL,
	"title_tokens" text NOT NULL,
	"body_tokens" text NOT NULL,
	"search_vector" "tsvector" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "search_documents_vector_idx" ON "search_documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "search_documents_thread_idx" ON "search_documents" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "search_documents_category_created_idx" ON "search_documents" USING btree ("category_id","created_at");
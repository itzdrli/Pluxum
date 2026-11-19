ALTER TABLE "categories" ADD COLUMN "kind" text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "engagement" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_parent_id_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_to_id_users_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_thread_parent_idx" ON "posts" USING btree ("thread_id","parent_id","created_at");--> statement-breakpoint
INSERT INTO "categories" ("slug", "name", "description", "position", "kind")
VALUES ('stream', '动态', '随手发的短内容，不用标题。', 0, 'stream')
ON CONFLICT ("slug") DO NOTHING;

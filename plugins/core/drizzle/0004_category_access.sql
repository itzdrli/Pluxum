ALTER TABLE "categories" ADD COLUMN "view_role" text DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "post_role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "reply_role" text DEFAULT 'member' NOT NULL;
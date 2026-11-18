CREATE TABLE "mail_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "mail_addresses" CASCADE;
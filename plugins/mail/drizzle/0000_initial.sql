CREATE TABLE "mail_addresses" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_sent_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_post_id_user_id_kind_pk" PRIMARY KEY("post_id","user_id","kind")
);

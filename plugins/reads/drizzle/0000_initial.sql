CREATE TABLE "reader_baselines" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_reads" (
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_reads_user_id_thread_id_pk" PRIMARY KEY("user_id","thread_id")
);

ALTER TABLE "notifications" ADD COLUMN "title_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "title_params" jsonb;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.reply.topic', "title_params" = jsonb_build_object('actor', s.m[1], 'title', s.m[2])
FROM (SELECT "id", regexp_match("title", '^(.*) 回复了你的主题《(.*)》$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.reply.note', "title_params" = jsonb_build_object('actor', s.m[1])
FROM (SELECT "id", regexp_match("title", '^(.*) 回复了你的动态$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.reply.in_topic', "title_params" = jsonb_build_object('actor', s.m[1], 'title', s.m[2])
FROM (SELECT "id", regexp_match("title", '^(.*) 在《(.*)》中回复了你$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.reply.in_note', "title_params" = jsonb_build_object('actor', s.m[1])
FROM (SELECT "id", regexp_match("title", '^(.*) 在动态中回复了你$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.mention.in_topic', "title_params" = jsonb_build_object('actor', s.m[1], 'title', s.m[2])
FROM (SELECT "id", regexp_match("title", '^(.*) 在《(.*)》中提到了你$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.mention.in_note', "title_params" = jsonb_build_object('actor', s.m[1])
FROM (SELECT "id", regexp_match("title", '^(.*) 在动态中提到了你$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.follow', "title_params" = jsonb_build_object('actor', s.m[1])
FROM (SELECT "id", regexp_match("title", '^(.*) 关注了你$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
--> statement-breakpoint
-- Rows written before this migration only have the finished Chinese title: read the parts back out.
UPDATE "notifications" SET "title_key" = 'notice.accepted', "title_params" = jsonb_build_object('actor', s.m[1])
FROM (SELECT "id", regexp_match("title", '^(.*) 采纳了你的回答$') AS m FROM "notifications" WHERE "title_key" IS NULL) AS s
WHERE "notifications"."id" = s."id" AND s.m IS NOT NULL;
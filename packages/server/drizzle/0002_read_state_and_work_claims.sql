CREATE TABLE "squawk_reads" (
	"squawk_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "squawk_reads_squawk_id_user_id_pk" PRIMARY KEY("squawk_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "squawks" ADD COLUMN "working_user_id" uuid;--> statement-breakpoint
ALTER TABLE "squawks" ADD COLUMN "working_token_id" uuid;--> statement-breakpoint
ALTER TABLE "squawks" ADD COLUMN "working_since" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "squawk_reads" ADD CONSTRAINT "squawk_reads_squawk_id_squawks_id_fk" FOREIGN KEY ("squawk_id") REFERENCES "public"."squawks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawk_reads" ADD CONSTRAINT "squawk_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_working_user_id_users_id_fk" FOREIGN KEY ("working_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_working_token_id_tokens_id_fk" FOREIGN KEY ("working_token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_working_claimant" CHECK ((working_user_id is null and working_token_id is null and working_since is null) or (working_since is not null and num_nonnulls(working_user_id, working_token_id) >= 1));--> statement-breakpoint
-- Existing squawks count as read for each user up to their own newest comment (the body is the
-- first comment, so authors have read their squawk); everything else, and anything their agents
-- wrote, stays unread. Drafts are never unread and get no rows.
INSERT INTO "squawk_reads" ("squawk_id", "user_id", "read_at")
SELECT "comments"."squawk_id", "comments"."author_user_id", max("comments"."created_at")
FROM "comments"
INNER JOIN "squawks" ON "squawks"."id" = "comments"."squawk_id"
WHERE "comments"."author_user_id" IS NOT NULL
   AND "comments"."author_token_id" IS NULL
   AND "squawks"."submitted_at" IS NOT NULL
GROUP BY "comments"."squawk_id", "comments"."author_user_id";

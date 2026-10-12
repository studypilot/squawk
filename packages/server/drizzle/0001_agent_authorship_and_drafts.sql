CREATE TYPE "public"."token_client" AS ENUM('overlay', 'cli');--> statement-breakpoint
ALTER TYPE "public"."squawk_status" ADD VALUE 'draft';--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_one_author";--> statement-breakpoint
ALTER TABLE "squawks" DROP CONSTRAINT "squawks_one_author";--> statement-breakpoint
ALTER TABLE "squawks" DROP CONSTRAINT "squawks_resolver_matches_status";--> statement-breakpoint
ALTER TABLE "squawks" ADD COLUMN "submitted_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "client" "token_client";--> statement-breakpoint
-- Existing squawks were never drafts: they count as submitted when they were created.
UPDATE "squawks" SET "submitted_at" = "created_at";--> statement-breakpoint
-- Existing login tokens: the device flow named CLI tokens `CLI <host>`; everything else is an overlay.
UPDATE "tokens" SET "client" = CASE WHEN "name" LIKE 'CLI %' THEN 'cli'::"token_client" ELSE 'overlay'::"token_client" END WHERE "kind" = 'login';--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_one_author" CHECK (num_nonnulls(author_user_id, author_token_id) >= 1);--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_submitted_unless_draft" CHECK ((status in ('open', 'resolved')) = (submitted_at is not null));--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_one_author" CHECK (num_nonnulls(author_user_id, author_token_id) >= 1);--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_resolver_matches_status" CHECK ((status <> 'resolved' and resolved_at is null and resolved_by_user_id is null and resolved_by_token_id is null) or (status = 'resolved' and resolved_at is not null and num_nonnulls(resolved_by_user_id, resolved_by_token_id) >= 1));

CREATE TYPE "public"."device_kind" AS ENUM('overlay', 'cli');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."screenshot_source" AS ENUM('extension', 'dom');--> statement-breakpoint
CREATE TYPE "public"."squawk_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."token_kind" AS ENUM('login', 'agent');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squawk_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"author_token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_one_author" CHECK (num_nonnulls(author_user_id, author_token_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"kind" "device_kind" NOT NULL,
	"label" text NOT NULL,
	"status" "device_status" DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"last_polled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squawk_id" uuid NOT NULL,
	"path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"device_pixel_ratio" real NOT NULL,
	"source" "screenshot_source" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenshots_squawk_id_unique" UNIQUE("squawk_id")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"display_name" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "squawks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"page" text NOT NULL,
	"number" integer NOT NULL,
	"status" "squawk_status" DEFAULT 'open' NOT NULL,
	"anchor" jsonb,
	"meta" jsonb NOT NULL,
	"author_user_id" uuid,
	"author_token_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	"resolved_by_user_id" uuid,
	"resolved_by_token_id" uuid,
	CONSTRAINT "squawks_one_author" CHECK (num_nonnulls(author_user_id, author_token_id) = 1),
	CONSTRAINT "squawks_resolver_matches_status" CHECK ((status = 'open' and resolved_at is null and resolved_by_user_id is null and resolved_by_token_id is null) or (status = 'resolved' and resolved_at is not null and num_nonnulls(resolved_by_user_id, resolved_by_token_id) = 1))
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "token_kind" NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"site_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"last_used_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp (3) with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_squawk_id_squawks_id_fk" FOREIGN KEY ("squawk_id") REFERENCES "public"."squawks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_token_id_tokens_id_fk" FOREIGN KEY ("author_token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_squawk_id_squawks_id_fk" FOREIGN KEY ("squawk_id") REFERENCES "public"."squawks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_author_token_id_tokens_id_fk" FOREIGN KEY ("author_token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_resolved_by_token_id_tokens_id_fk" FOREIGN KEY ("resolved_by_token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_squawk_created_index" ON "comments" USING btree ("squawk_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_codes_user_code_index" ON "device_codes" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_codes_device_code_hash_index" ON "device_codes" USING btree ("device_code_hash");--> statement-breakpoint
CREATE INDEX "squawks_site_status_created_index" ON "squawks" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "squawks_site_number_index" ON "squawks" USING btree ("site_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_hash_index" ON "tokens" USING btree ("hash");
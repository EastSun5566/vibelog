CREATE TABLE "account" (
	"id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_daily_usage" (
	"usage_date" date NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_daily_usage_usage_date_scope_subject_pk" PRIMARY KEY("usage_date","scope","subject"),
	CONSTRAINT "ai_usage_scope_check" CHECK ("ai_daily_usage"."scope" in ('user','global')),
	CONSTRAINT "ai_usage_count_check" CHECK ("ai_daily_usage"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"blog_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key_prefix" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "artifacts_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('draft','release')),
	CONSTRAINT "artifacts_state_check" CHECK ("artifacts"."state" in ('uploading','ready','cleanup_pending'))
);
--> statement-breakpoint
CREATE TABLE "blogs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"hackmd_username" text NOT NULL,
	"title" text,
	"description" text,
	"author" text,
	"language" text DEFAULT 'zh-Hant' NOT NULL,
	"state" text NOT NULL,
	"last_error" text,
	"draft_artifact_id" uuid,
	"content_version" integer DEFAULT 0 NOT NULL,
	"content_manifest" jsonb,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blogs_handle_check" CHECK ("blogs"."username" ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$'),
	CONSTRAINT "blogs_state_check" CHECK ("blogs"."state" in ('syncing','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "operation_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"event_type" text DEFAULT 'operation.requested' NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_outbox_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"blog_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_type_check" CHECK ("operations"."type" in ('sync','generate_theme','publish')),
	CONSTRAINT "operations_status_check" CHECK ("operations"."status" in ('queued','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "preview_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"blog_id" uuid NOT NULL,
	"theme_config" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"blog_id" uuid NOT NULL,
	"theme_revision_id" uuid NOT NULL,
	"content_version" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"artifact_id" uuid NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" integer NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "theme_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"blog_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"prompt" text,
	"description" text NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blogs" ADD CONSTRAINT "blogs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_outbox" ADD CONSTRAINT "operation_outbox_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_sessions" ADD CONSTRAINT "preview_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_sessions" ADD CONSTRAINT "preview_sessions_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_releases" ADD CONSTRAINT "published_releases_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_releases" ADD CONSTRAINT "published_releases_theme_revision_id_theme_revisions_id_fk" FOREIGN KEY ("theme_revision_id") REFERENCES "public"."theme_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_releases" ADD CONSTRAINT "published_releases_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_revisions" ADD CONSTRAINT "theme_revisions_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artifacts_blog_idx" ON "artifacts" USING btree ("blog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_one_per_user" ON "blogs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_username_unique" ON "blogs" USING btree ("username");--> statement-breakpoint
CREATE INDEX "operation_outbox_pending_idx" ON "operation_outbox" USING btree ("dispatched_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_one_active_per_blog" ON "operations" USING btree ("blog_id") WHERE "operations"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "operations_claim_idx" ON "operations" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "published_releases_blog_idx" ON "published_releases" USING btree ("blog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "published_releases_one_active" ON "published_releases" USING btree ("blog_id") WHERE "published_releases"."active";--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "theme_revisions_blog_idx" ON "theme_revisions" USING btree ("blog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "theme_revisions_one_active" ON "theme_revisions" USING btree ("blog_id") WHERE "theme_revisions"."active";--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");

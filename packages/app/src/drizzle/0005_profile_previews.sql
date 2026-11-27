CREATE TABLE "profile_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"hackmd_username" text NOT NULL,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"stage" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"source_artifact_id" uuid,
	"draft_artifact_id" uuid,
	"design" jsonb,
	"design_source" text,
	"title" text,
	"author" text,
	"content_profile" jsonb,
	"error_message" text,
	"generated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_previews_name_key_unique" UNIQUE("name_key"),
	CONSTRAINT "profile_previews_label_unique" UNIQUE("label"),
	CONSTRAINT "profile_previews_state_check" CHECK ("profile_previews"."state" in ('queued','building','ready','failed')),
	CONSTRAINT "profile_previews_design_source_check" CHECK ("profile_previews"."design_source" is null or "profile_previews"."design_source" in ('preset','ai'))
);
--> statement-breakpoint
CREATE INDEX "profile_previews_state_idx" ON "profile_previews" USING btree ("state","updated_at");
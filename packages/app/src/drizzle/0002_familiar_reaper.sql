ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_kind_check";--> statement-breakpoint
ALTER TABLE "operations" DROP CONSTRAINT "operations_type_check";--> statement-breakpoint
UPDATE "operations" SET "type" = 'generate_design' WHERE "type" = 'generate_theme';--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "source_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "draft_design_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "content_profile" jsonb;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('source','draft','release'));--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_type_check" CHECK ("operations"."type" in ('sync','generate_design','apply_design','activate_design','publish'));

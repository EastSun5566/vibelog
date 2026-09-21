ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_kind_check";--> statement-breakpoint
ALTER TABLE "operations" DROP CONSTRAINT "operations_type_check";--> statement-breakpoint
UPDATE "operation_outbox"
SET "dispatched_at" = now()
WHERE "dispatched_at" IS NULL
  AND "operation_id" IN (
    SELECT "id"
    FROM "operations"
    WHERE "type" = 'generate_theme'
      AND "status" IN ('queued', 'running')
  );--> statement-breakpoint
UPDATE "operations"
SET "status" = 'failed',
    "error_message" = 'This design operation was canceled during the Presentation IR upgrade. Sync the content and try again.',
    "locked_at" = NULL,
    "lease_expires_at" = NULL,
    "updated_at" = now()
WHERE "type" = 'generate_theme'
  AND "status" IN ('queued', 'running');--> statement-breakpoint
UPDATE "operations" SET "type" = 'generate_design' WHERE "type" = 'generate_theme';--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "source_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "draft_design_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "content_profile" jsonb;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('source','draft','release'));--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_type_check" CHECK ("operations"."type" in ('sync','generate_design','apply_design','activate_design','publish'));

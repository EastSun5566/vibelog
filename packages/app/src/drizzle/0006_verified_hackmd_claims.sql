ALTER TABLE "blogs" ADD COLUMN "hackmd_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_previews" ADD COLUMN "language" text;--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_verified_hackmd_unique" ON "blogs" USING btree (lower("hackmd_username")) WHERE "blogs"."hackmd_verified_at" is not null;
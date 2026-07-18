CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `ai_daily_usage` (
	`usage_date` text NOT NULL,
	`scope` text NOT NULL,
	`subject` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`usage_date`, `scope`, `subject`),
	CONSTRAINT "ai_usage_scope_check" CHECK("ai_daily_usage"."scope" in ('user','global')),
	CONSTRAINT "ai_usage_count_check" CHECK("ai_daily_usage"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blogs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`hackmd_username` text NOT NULL,
	`title` text,
	`description` text,
	`author` text,
	`state` text NOT NULL,
	`last_error` text,
	`draft_artifact` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "blogs_state_check" CHECK("blogs"."state" in ('syncing','ready','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blogs_one_per_user` ON `blogs` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blogs_username_unique` ON `blogs` (`username`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`blog_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blog_id`) REFERENCES `blogs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operations_type_check" CHECK("operations"."type" in ('sync','generate_theme','publish')),
	CONSTRAINT "operations_status_check" CHECK("operations"."status" in ('queued','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_one_active_per_blog` ON `operations` (`blog_id`) WHERE "operations"."status" in ('queued','running');--> statement-breakpoint
CREATE TABLE `preview_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`blog_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blog_id`) REFERENCES `blogs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `published_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`blog_id` text NOT NULL,
	`theme_revision_id` text NOT NULL,
	`artifact` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`blog_id`) REFERENCES `blogs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_revision_id`) REFERENCES `theme_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `published_releases_blog_idx` ON `published_releases` (`blog_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `published_releases_one_active` ON `published_releases` (`blog_id`) WHERE "published_releases"."active" = 1;--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `theme_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`blog_id` text NOT NULL,
	`config` text NOT NULL,
	`prompt` text,
	`description` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`blog_id`) REFERENCES `blogs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `theme_revisions_blog_idx` ON `theme_revisions` (`blog_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `theme_revisions_one_active` ON `theme_revisions` (`blog_id`) WHERE "theme_revisions"."active" = 1;--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`username` text,
	`display_username` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
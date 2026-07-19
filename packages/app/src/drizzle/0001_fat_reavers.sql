ALTER TABLE `blogs` ADD `content_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `published_releases` ADD `content_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `blogs` SET `content_version` = 1 WHERE `draft_artifact` IS NOT NULL;

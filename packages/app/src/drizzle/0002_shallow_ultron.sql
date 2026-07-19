ALTER TABLE `preview_sessions` ADD `theme_config` text;--> statement-breakpoint
ALTER TABLE `theme_revisions` ADD `source` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
UPDATE `theme_revisions` SET `source` = 'ai' WHERE `prompt` IS NOT NULL;

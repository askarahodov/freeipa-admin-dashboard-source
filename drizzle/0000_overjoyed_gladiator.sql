CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`encrypted_secrets` text NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `xyops_catalog_history` (
	`id` text PRIMARY KEY NOT NULL,
	`synced_at` integer NOT NULL,
	`changes_json` text NOT NULL,
	`catalog_json` text NOT NULL
);

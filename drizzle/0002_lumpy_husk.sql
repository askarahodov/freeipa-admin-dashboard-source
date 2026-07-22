CREATE TABLE `xyops_catalog_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_json` text NOT NULL,
	`synced_at` integer NOT NULL
);

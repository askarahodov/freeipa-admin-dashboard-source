CREATE TABLE `operation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`subject` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);

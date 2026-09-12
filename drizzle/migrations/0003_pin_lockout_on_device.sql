ALTER TABLE "devices" ADD COLUMN "failed_pin_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_members" DROP COLUMN "failed_pin_attempts";--> statement-breakpoint
ALTER TABLE "tenant_members" DROP COLUMN "locked_until";
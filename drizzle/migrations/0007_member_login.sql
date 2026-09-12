ALTER TABLE "tenant_members" ALTER COLUMN "user_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "login_locked_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_email_key" ON "tenant_members" USING btree (lower("email"));
-- 'closed' marca la tarjeta de un cliente suprimido: el pase deja de emitirse
-- pero la tarjeta y su ledger siguen existiendo para la cuadratura del negocio.
ALTER TYPE "public"."card_status" ADD VALUE 'closed';--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
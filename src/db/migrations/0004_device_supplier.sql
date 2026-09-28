ALTER TABLE "devices" ADD COLUMN "supplier_name" text;
--> statement-breakpoint
CREATE INDEX "devices_supplier_idx" ON "devices" USING btree ("supplier_name");

CREATE TABLE "idempotency_keys" (
	"idempotency_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_actor_key" ON "idempotency_keys" USING btree ("actor_user_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "api_key_hash" text;
--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD COLUMN "from_device_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_from_device_id_devices_device_id_fk" FOREIGN KEY ("from_device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_distinct_device_check" CHECK ("from_device_id" <> "device_id");

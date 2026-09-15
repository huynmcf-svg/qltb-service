CREATE TABLE "device_categories" (
	"category_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"device_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"status" text DEFAULT 'IN_STOCK' NOT NULL,
	"holder_name" text,
	"holder_unit" text,
	"purchased_at" date,
	"warranty_until" date,
	"purchase_price" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_history" (
	"history_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"holder_name" text,
	"holder_unit" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"actor_name" text,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_category_id_device_categories_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."device_categories"("category_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "device_history" ADD CONSTRAINT "device_history_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "device_categories_code_key" ON "device_categories" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "devices_code_key" ON "devices" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "devices_status_created_idx" ON "devices" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "devices_category_idx" ON "devices" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "device_history_device_occurred_idx" ON "device_history" USING btree ("device_id","occurred_at");

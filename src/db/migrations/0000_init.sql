CREATE TABLE "audit_logs" (
	"audit_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid,
	"actor_user_id" uuid,
	"actor_username" text,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprises" (
	"enterprise_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tax_code" text,
	"address" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"max_users" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"permission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "roles_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid,
	"username" text NOT NULL,
	"email" text,
	"full_name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "device_exchanges" (
	"exchange_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"old_device_id" uuid NOT NULL,
	"new_device_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reject_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"device_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" text NOT NULL,
	"device_type" text NOT NULL,
	"model" text,
	"name" text,
	"firmware_version" text,
	"enterprise_id" uuid,
	"status" text DEFAULT 'IN_STOCK' NOT NULL,
	"sold_at" date,
	"assigned_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranties" (
	"warranty_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"source" text DEFAULT 'SALE' NOT NULL,
	"transferred_from_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_quotas" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"quota_total" bigint DEFAULT 0 NOT NULL,
	"quota_used" bigint DEFAULT 0 NOT NULL,
	"quota_remaining" bigint DEFAULT 0 NOT NULL,
	"warn_threshold_pct" integer DEFAULT 20 NOT NULL,
	"package_start_at" timestamp with time zone,
	"package_end_at" timestamp with time zone,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_reason" text,
	"locked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_allocations" (
	"allocation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_enterprise_id" uuid NOT NULL,
	"to_enterprise_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"allocated_by" uuid,
	"note" text,
	"idempotency_key" text,
	"request_id" text,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_grants" (
	"grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"total_after" bigint NOT NULL,
	"granted_by" uuid,
	"note" text,
	"idempotency_key" text,
	"request_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"usage_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"client_ref" text NOT NULL,
	"amount" bigint DEFAULT 1 NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected" boolean DEFAULT false NOT NULL,
	"remaining_after" bigint,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"alert_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_parent_id_enterprises_enterprise_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_permission_id_permissions_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("permission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_old_device_id_devices_device_id_fk" FOREIGN KEY ("old_device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_new_device_id_devices_device_id_fk" FOREIGN KEY ("new_device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_requested_by_users_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_approved_by_users_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_quotas" ADD CONSTRAINT "device_quotas_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_from_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("from_enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_to_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("to_enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_allocated_by_users_user_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_granted_by_users_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_enterprise_id_enterprises_enterprise_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("enterprise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_alerts_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("alert_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_enterprise_occurred_idx" ON "audit_logs" USING btree ("enterprise_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_module_action_idx" ON "audit_logs" USING btree ("module","action");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_code_key" ON "enterprises" USING btree ("code");--> statement-breakpoint
CREATE INDEX "enterprises_parent_idx" ON "enterprises" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "enterprises_status_idx" ON "enterprises" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "permissions_group_idx" ON "permissions" USING btree ("group");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_key" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_enterprise_idx" ON "users" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_roles_role_idx" ON "users_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "device_exchanges_enterprise_status_idx" ON "device_exchanges" USING btree ("enterprise_id","status");--> statement-breakpoint
CREATE INDEX "device_exchanges_old_device_idx" ON "device_exchanges" USING btree ("old_device_id");--> statement-breakpoint
CREATE INDEX "device_exchanges_requested_idx" ON "device_exchanges" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_serial_number_key" ON "devices" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "devices_enterprise_idx" ON "devices" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "devices_status_created_idx" ON "devices" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "devices_type_idx" ON "devices" USING btree ("device_type");--> statement-breakpoint
CREATE INDEX "devices_last_seen_idx" ON "devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "warranties_device_idx" ON "warranties" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "warranties_status_end_idx" ON "warranties" USING btree ("status","end_date");--> statement-breakpoint
CREATE INDEX "warranties_enterprise_idx" ON "warranties" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "device_quotas_locked_idx" ON "device_quotas" USING btree ("is_locked");--> statement-breakpoint
CREATE INDEX "device_quotas_package_end_idx" ON "device_quotas" USING btree ("package_end_at");--> statement-breakpoint
CREATE INDEX "quota_allocations_from_idx" ON "quota_allocations" USING btree ("from_enterprise_id","allocated_at");--> statement-breakpoint
CREATE INDEX "quota_allocations_to_idx" ON "quota_allocations" USING btree ("to_enterprise_id","allocated_at");--> statement-breakpoint
CREATE INDEX "quota_allocations_device_idx" ON "quota_allocations" USING btree ("device_id","allocated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_allocations_idempotency_key" ON "quota_allocations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "quota_grants_device_granted_idx" ON "quota_grants" USING btree ("device_id","granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_grants_idempotency_key" ON "quota_grants" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_logs_device_client_ref_key" ON "usage_logs" USING btree ("device_id","client_ref");--> statement-breakpoint
CREATE INDEX "usage_logs_device_used_idx" ON "usage_logs" USING btree ("device_id","used_at");--> statement-breakpoint
CREATE INDEX "usage_logs_used_idx" ON "usage_logs" USING btree ("used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_device_type_dedupe_key" ON "alerts" USING btree ("device_id","type","dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_enterprise_occurred_idx" ON "alerts" USING btree ("enterprise_id","occurred_at");--> statement-breakpoint
CREATE INDEX "alerts_type_severity_idx" ON "alerts" USING btree ("type","severity");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_alert_user_key" ON "notifications" USING btree ("alert_id","user_id");
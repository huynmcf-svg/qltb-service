-- Viết tay. drizzle-kit KHÔNG sinh CHECK theo enum, partial unique index lẫn trigger.
-- Sau mỗi lần `drizzle-kit generate`, kiểm tra migration mới không drop những
-- thứ dưới đây. Giá trị enum khớp docs/api-contracts.md.

-- ── CHECK enum: text + CHECK thay vì pg enum (pg enum không DROP VALUE được) ──
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_status_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED'));
--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_max_users_check" CHECK ("max_users" >= 0);
--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_not_own_parent_check" CHECK ("parent_id" IS DISTINCT FROM "enterprise_id");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check"
  CHECK ("status" IN ('ACTIVE', 'DISABLED'));
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_status_check"
  CHECK ("status" IN ('IN_STOCK', 'ACTIVE', 'LOCKED', 'EXCHANGED', 'RETIRED'));
--> statement-breakpoint
-- Máy trong kho thì không thuộc doanh nghiệp nào; máy đang gán thì phải có.
ALTER TABLE "devices" ADD CONSTRAINT "devices_enterprise_by_status_check"
  CHECK (
    ("status" = 'IN_STOCK' AND "enterprise_id" IS NULL)
    OR ("status" IN ('ACTIVE', 'LOCKED') AND "enterprise_id" IS NOT NULL)
    OR ("status" IN ('EXCHANGED', 'RETIRED'))
  );
--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_status_check"
  CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'TRANSFERRED', 'VOID'));
--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_source_check"
  CHECK ("source" IN ('SALE', 'EXCHANGE', 'EXTENSION'));
--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_dates_check" CHECK ("end_date" >= "start_date");
--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_new_device_check"
  CHECK ("new_device_id" IS DISTINCT FROM "old_device_id");
--> statement-breakpoint
ALTER TABLE "device_exchanges" ADD CONSTRAINT "device_exchanges_approved_has_device_check"
  CHECK ("status" <> 'APPROVED' OR "new_device_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_type_check"
  CHECK ("type" IN ('QUOTA_BELOW_20', 'QUOTA_BELOW_10', 'QUOTA_EXHAUSTED',
                    'WARRANTY_30D', 'WARRANTY_15D', 'WARRANTY_7D', 'WARRANTY_EXPIRED', 'DEVICE_OFFLINE'));
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_severity_check"
  CHECK ("severity" IN ('INFO', 'WARNING', 'CRITICAL'));
--> statement-breakpoint

-- ── Bất biến sản lượng: còn lại = tổng − đã dùng, không âm ──────────────────
ALTER TABLE "device_quotas" ADD CONSTRAINT "device_quotas_balance_check"
  CHECK ("quota_remaining" = "quota_total" - "quota_used" AND "quota_remaining" >= 0 AND "quota_used" >= 0);
--> statement-breakpoint
ALTER TABLE "device_quotas" ADD CONSTRAINT "device_quotas_threshold_check"
  CHECK ("warn_threshold_pct" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "device_quotas" ADD CONSTRAINT "device_quotas_locked_reason_check"
  CHECK ("locked_reason" IS NULL OR "locked_reason" IN ('QUOTA_EXHAUSTED', 'PACKAGE_EXPIRED', 'MANUAL'));
--> statement-breakpoint
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_amount_check" CHECK ("amount" > 0);
--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_amount_check" CHECK ("amount" > 0);
--> statement-breakpoint
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_distinct_check"
  CHECK ("from_enterprise_id" <> "to_enterprise_id");
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_amount_check" CHECK ("amount" > 0);
--> statement-breakpoint

-- ── Partial unique: một bảo hành ACTIVE / một yêu cầu PENDING mỗi máy ───────
CREATE UNIQUE INDEX "warranties_one_active_per_device"
  ON "warranties" ("device_id") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX "device_exchanges_one_pending_per_device"
  ON "device_exchanges" ("old_device_id") WHERE "status" = 'PENDING';
--> statement-breakpoint

-- ── Append-only: lịch sử không UPDATE / DELETE được, kể cả bởi code có bug ──
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bảng % là append-only, không cho %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quota_grants_append_only BEFORE UPDATE OR DELETE ON "quota_grants"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER quota_allocations_append_only BEFORE UPDATE OR DELETE ON "quota_allocations"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER usage_logs_append_only BEFORE UPDATE OR DELETE ON "usage_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- ── updated_at tự cập nhật ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER enterprises_touch_updated_at BEFORE UPDATE ON "enterprises" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER roles_touch_updated_at BEFORE UPDATE ON "roles" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER devices_touch_updated_at BEFORE UPDATE ON "devices" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER warranties_touch_updated_at BEFORE UPDATE ON "warranties" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER device_exchanges_touch_updated_at BEFORE UPDATE ON "device_exchanges" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER device_quotas_touch_updated_at BEFORE UPDATE ON "device_quotas" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

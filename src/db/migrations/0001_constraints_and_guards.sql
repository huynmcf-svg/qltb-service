-- Viết tay. drizzle-kit KHÔNG sinh CHECK theo enum lẫn trigger.
-- Sau mỗi lần `drizzle-kit generate`, kiểm tra migration mới không drop những
-- thứ dưới đây.

-- ── CHECK trạng thái / action: text + CHECK thay vì pg enum, vì đổi enum trong
--    Postgres là migration khó chịu (không DROP VALUE được).
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_status_check"
  CHECK ("status" IN ('IN_STOCK', 'IN_USE', 'UNDER_MAINTENANCE', 'DISPOSED'));
--> statement-breakpoint
ALTER TABLE "device_history"
  ADD CONSTRAINT "device_history_action_check"
  CHECK ("action" IN ('REGISTER', 'ASSIGN', 'RETURN', 'TRANSFER', 'MAINTENANCE_START', 'MAINTENANCE_END', 'DISPOSE'));
--> statement-breakpoint
ALTER TABLE "device_history"
  ADD CONSTRAINT "device_history_to_status_check"
  CHECK ("to_status" IN ('IN_STOCK', 'IN_USE', 'UNDER_MAINTENANCE', 'DISPOSED'));
--> statement-breakpoint

-- ── Append-only: device_history không UPDATE / DELETE được, kể cả bởi code
--    có bug. Lịch sử mất là kiểm kê sai không sửa lại được.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bảng % là append-only, không cho %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER device_history_append_only
  BEFORE UPDATE OR DELETE ON "device_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- ── updated_at tự cập nhật, để không module nào quên.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER devices_touch_updated_at
  BEFORE UPDATE ON "devices"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER device_categories_touch_updated_at
  BEFORE UPDATE ON "device_categories"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

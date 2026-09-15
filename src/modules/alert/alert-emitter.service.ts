import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { alerts, enterprises, notifications, users, type AlertSeverity, type AlertType } from '../../db/schema';

export interface EmitAlertInput {
  device_id: string;
  enterprise_id: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  payload?: Record<string, unknown>;
  /** Cùng (device, type, dedupe_key) chỉ phát MỘT lần. */
  dedupe_key: string;
}

/**
 * Phát cảnh báo + rải thông báo. Chỉ phụ thuộc DRIZZLE nên module nào cũng
 * gọi được (quota gọi ngay khi ghi lượt dùng; job quét gọi định kỳ) mà không
 * tạo vòng import.
 *
 * Người nhận: mọi người dùng ACTIVE của doanh nghiệp (và DN cha nếu là chi
 * nhánh) + quản trị hệ thống (enterprise_id NULL).
 */
@Injectable()
export class AlertEmitter {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Trả `alert_id` nếu vừa phát, `null` nếu đã có (dedupe). */
  async emit(input: EmitAlertInput): Promise<string | null> {
    const [created] = await this.db
      .insert(alerts)
      .values({
        device_id: input.device_id,
        enterprise_id: input.enterprise_id,
        type: input.type,
        severity: input.severity,
        message: input.message,
        payload: input.payload ?? {},
        dedupe_key: input.dedupe_key,
      })
      .onConflictDoNothing()
      .returning({ alert_id: alerts.alert_id });
    if (!created) return null;

    const recipients = await this.recipients(input.enterprise_id);
    if (recipients.length) {
      await this.db
        .insert(notifications)
        .values(recipients.map((user_id) => ({ alert_id: created.alert_id, user_id, title: TITLES[input.type], body: input.message })))
        .onConflictDoNothing();
    }
    return created.alert_id;
  }

  /** Đóng cảnh báo đang mở của một máy theo loại (khi sản lượng được cấp thêm, máy online lại). */
  async resolve(device_id: string, types: AlertType[]): Promise<number> {
    const rows = await this.db
      .update(alerts)
      .set({ resolved_at: new Date() })
      .where(and(eq(alerts.device_id, device_id), inArray(alerts.type, types), isNull(alerts.resolved_at)))
      .returning({ id: alerts.alert_id });
    return rows.length;
  }

  private async recipients(enterprise_id: string | null): Promise<string[]> {
    const conditions = [isNull(users.enterprise_id)];
    if (enterprise_id) {
      const [ent] = await this.db.select({ parent_id: enterprises.parent_id }).from(enterprises).where(eq(enterprises.enterprise_id, enterprise_id)).limit(1);
      const ids = [enterprise_id, ...(ent?.parent_id ? [ent.parent_id] : [])];
      conditions.push(inArray(users.enterprise_id, ids));
    }
    const rows = await this.db
      .select({ user_id: users.user_id })
      .from(users)
      .where(and(eq(users.status, 'ACTIVE'), isNull(users.deleted_at), or(...conditions)));
    return rows.map((r) => r.user_id);
  }
}

export const TITLES: Record<AlertType, string> = {
  QUOTA_BELOW_20: 'Sản lượng còn dưới 20 %',
  QUOTA_BELOW_10: 'Sản lượng còn dưới 10 %',
  QUOTA_EXHAUSTED: 'Hết sản lượng',
  WARRANTY_30D: 'Bảo hành còn 30 ngày',
  WARRANTY_15D: 'Bảo hành còn 15 ngày',
  WARRANTY_7D: 'Bảo hành còn 7 ngày',
  WARRANTY_EXPIRED: 'Bảo hành đã hết hạn',
  DEVICE_OFFLINE: 'Thiết bị mất kết nối',
};

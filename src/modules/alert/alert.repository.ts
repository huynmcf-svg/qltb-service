import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrder, cursorWhere, defined, pageLimit, toPage } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { ALERT_TYPES, alerts, devices, enterprises, notifications, type AlertType } from '../../db/schema';
import { groupOf, type AlertView, type ListAlertsDto, type ListNotificationsDto, type NotificationView } from './dto/alert.dto';

type AlertRow = typeof alerts.$inferSelect;

@Injectable()
export class AlertRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private base() {
    return this.db
      .select({ a: alerts, serial: devices.serial_number, enterprise_name: enterprises.name })
      .from(alerts)
      .innerJoin(devices, eq(alerts.device_id, devices.device_id))
      .leftJoin(enterprises, eq(alerts.enterprise_id, enterprises.enterprise_id));
  }

  async list(query: ListAlertsDto, scope: string[] | null): Promise<CursorPage<AlertView>> {
    const limit = pageLimit(query);
    const types = query.group ? ALERT_TYPES.filter((t) => groupOf(t) === query.group) : undefined;
    const conditions = defined([
      scopeCondition(alerts.enterprise_id, scope),
      types ? inArray(alerts.type, types) : undefined,
      query.severity ? eq(alerts.severity, query.severity) : undefined,
      query.enterprise_id ? eq(alerts.enterprise_id, query.enterprise_id) : undefined,
      query.device_id ? eq(alerts.device_id, query.device_id) : undefined,
      query.from ? gte(alerts.occurred_at, new Date(query.from)) : undefined,
      query.to ? lte(alerts.occurred_at, new Date(query.to)) : undefined,
      query.resolved === true ? isNotNull(alerts.resolved_at) : query.resolved === false ? isNull(alerts.resolved_at) : undefined,
      cursorWhere(alerts.occurred_at, alerts.alert_id, query),
    ]);
    const rows = await this.base()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(alerts.occurred_at, alerts.alert_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.a.occurred_at, id: r.a.alert_id }), (r) => toView(r.a, r.serial, r.enterprise_name));
  }

  async findById(alert_id: string): Promise<AlertView | null> {
    const [row] = await this.base().where(eq(alerts.alert_id, alert_id)).limit(1);
    return row ? toView(row.a, row.serial, row.enterprise_name) : null;
  }

  async listNotifications(user_id: string, query: ListNotificationsDto): Promise<CursorPage<NotificationView>> {
    const limit = pageLimit(query);
    const rows = await this.db
      .select({ n: notifications, a: alerts, serial: devices.serial_number })
      .from(notifications)
      .innerJoin(alerts, eq(notifications.alert_id, alerts.alert_id))
      .innerJoin(devices, eq(alerts.device_id, devices.device_id))
      .where(and(eq(notifications.user_id, user_id), query.unread ? isNull(notifications.read_at) : undefined, cursorWhere(notifications.created_at, notifications.notification_id, query)))
      .orderBy(...cursorOrder(notifications.created_at, notifications.notification_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.n.created_at, id: r.n.notification_id }), (r) => ({
      notification_id: r.n.notification_id,
      alert_id: r.n.alert_id,
      title: r.n.title,
      body: r.n.body,
      alert: { type: r.a.type, severity: r.a.severity, device_id: r.a.device_id, serial_number: r.serial },
      read_at: r.n.read_at?.toISOString() ?? null,
      created_at: r.n.created_at.toISOString(),
    }));
  }

  async unreadCount(user_id: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.user_id, user_id), isNull(notifications.read_at)));
    return Number(row?.n ?? 0);
  }

  /** Chỉ của chính người gọi — của người khác coi như không tồn tại. */
  async markRead(user_id: string, notification_id: string): Promise<boolean> {
    const rows = await this.db
      .update(notifications)
      .set({ read_at: new Date() })
      .where(and(eq(notifications.notification_id, notification_id), eq(notifications.user_id, user_id), isNull(notifications.read_at)))
      .returning({ id: notifications.notification_id });
    if (rows.length) return true;
    const [exists] = await this.db.select({ id: notifications.notification_id }).from(notifications).where(and(eq(notifications.notification_id, notification_id), eq(notifications.user_id, user_id))).limit(1);
    return !!exists;
  }

  async markAllRead(user_id: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ read_at: new Date() })
      .where(and(eq(notifications.user_id, user_id), isNull(notifications.read_at)))
      .returning({ id: notifications.notification_id });
    return rows.length;
  }
}

export function toView(a: AlertRow, serial_number: string, enterprise_name: string | null): AlertView {
  return {
    alert_id: a.alert_id,
    device_id: a.device_id,
    serial_number,
    enterprise_id: a.enterprise_id,
    enterprise_name,
    type: a.type as AlertType,
    group: groupOf(a.type as AlertType),
    severity: a.severity,
    message: a.message,
    payload: a.payload,
    occurred_at: a.occurred_at.toISOString(),
    resolved_at: a.resolved_at?.toISOString() ?? null,
  };
}

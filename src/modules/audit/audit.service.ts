import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { audit_logs } from '../../db/schema';
import { AppLogger } from '../../common/logger/app-logger.service';

/** Mã hành động — UPPER_SNAKE_CASE, thêm khi có module mới. */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTH_REFRESH_REUSE_DETECTED: 'AUTH_REFRESH_REUSE_DETECTED',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_CHANGE_PASSWORD: 'AUTH_CHANGE_PASSWORD',
  AUTH_UPDATE_PROFILE: 'AUTH_UPDATE_PROFILE',
  DEVICE_CREATE: 'DEVICE_CREATE',
  DEVICE_UPDATE: 'DEVICE_UPDATE',
} as const;
/** UPPER_SNAKE_CASE. Bảng trên là các mã đã dùng; module mới thêm mã mới tại chỗ. */
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

export interface AuditActor {
  user_id: string;
  username: string;
}

export interface AuditEntry {
  module: string;
  action: AuditAction;
  resource_type: string;
  resource_id?: string | null;
  /** Doanh nghiệp BỊ TÁC ĐỘNG — để người dùng DN lọc được của mình. */
  enterprise_id?: string | null;
  /** NULL khi không có người: login thất bại, job. */
  actor?: AuditActor | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  request_id?: string;
  ip?: string;
  user_agent?: string;
}

/**
 * Ghi nhật ký kiểm toán — bảng append-only, chỉ có `record()`, không có sửa/xoá.
 * Ghi audit thất bại KHÔNG được làm thao tác chính thất bại: log lỗi rồi đi tiếp.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly logger: AppLogger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(audit_logs).values({
        module: entry.module,
        action: entry.action,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id ?? null,
        enterprise_id: entry.enterprise_id ?? null,
        actor_user_id: entry.actor?.user_id ?? null,
        actor_username: entry.actor?.username ?? null,
        old_values: entry.old_values ?? null,
        new_values: entry.new_values ?? null,
        request_id: entry.request_id ?? null,
        ip: entry.ip ?? null,
        user_agent: entry.user_agent ?? null,
      });
    } catch (error) {
      this.logger.error('audit write failed', {
        request_id: entry.request_id,
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

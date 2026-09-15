import { inArray, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { AppException } from '../errors/app.exception';
import type { AuthenticatedUser } from './authenticated-user';

const NIL = '00000000-0000-0000-0000-000000000000';

/** `scope = null` là quản trị hệ thống. Bản ghi không thuộc DN nào chỉ admin thấy. */
export function inScope(enterprise_id: string | null | undefined, scope: string[] | null): boolean {
  if (scope === null) return true;
  return !!enterprise_id && scope.includes(enterprise_id);
}

/** Điều kiện WHERE theo phạm vi; `undefined` khi admin (không lọc). */
export function scopeCondition(column: PgColumn, scope: string[] | null): SQL | undefined {
  if (scope === null) return undefined;
  return inArray(column, scope.length ? scope : [NIL]);
}

/** Ngoài phạm vi → 404, không 403: không xác nhận id tồn tại. */
export function assertInScope(resource: string, id: string, enterprise_id: string | null | undefined, actor: AuthenticatedUser): void {
  if (!inScope(enterprise_id, actor.scope)) throw AppException.notFound(resource, id);
}

/** Thao tác chỉ admin hệ thống (scope null) mới làm được. */
export function assertSystemAdmin(actor: AuthenticatedUser, what: string): void {
  if (actor.scope !== null) {
    throw AppException.authorizationFailed(`Chỉ quản trị hệ thống mới ${what}`, { required_scope: 'SYSTEM' });
  }
}

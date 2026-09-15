import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { inScope, scopeCondition } from '../../common/auth/scope';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { cursorOrder, cursorWhere, defined, pageLimit, toPage } from '../../common/dto/cursor-page';
import { AppException } from '../../common/errors/app.exception';
import { EX } from '../../common/swagger/example-values';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiNotFoundError, ApiValidationError } from '../../common/swagger/api-envelope';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { audit_logs, enterprises } from '../../db/schema';
import { ListAuditLogsDto, type AuditLogView } from './dto/audit.dto';

const EXAMPLE_AUDIT: AuditLogView = {
  audit_id: 'e1f2a3b4-0000-4000-8000-000000000011',
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
  actor_user_id: EX.user_id,
  actor_username: 'admin',
  module: 'device',
  action: 'DEVICE_ASSIGN',
  resource_type: 'device',
  resource_id: EX.device_id,
  old_values: { status: 'IN_STOCK', enterprise_id: null },
  new_values: { status: 'ACTIVE', enterprise_id: EX.enterprise_id, sold_at: '2026-01-15', warranty_months: 12 },
  request_id: 'a3f1c9e4-7b62-4d18-9f03-2c5e81aa4d77',
  ip: '10.0.0.12',
  user_agent: 'Mozilla/5.0',
  occurred_at: EX.now,
};

/** Chỉ đọc — bảng append-only, không có đường ghi qua API. */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Nhật ký thao tác', description: 'Cursor theo thời gian. Lọc `actor_user_id`, `enterprise_id`, `module` (nhóm chức năng), `action`, `resource_type` + `resource_id` (lịch sử một bản ghi), `from`/`to`. Người dùng DN chỉ thấy bản ghi gắn DN mình; bản ghi toàn hệ thống (enterprise NULL) chỉ admin thấy.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_AUDIT], next_cursor: EX.cursor } })
  @ApiValidationError() @ApiAuthErrors()
  async list(@Query() query: ListAuditLogsDto, @CurrentUser() actor: AuthenticatedUser) {
    const limit = pageLimit(query);
    const conditions = defined([
      scopeCondition(audit_logs.enterprise_id, actor.scope),
      query.actor_user_id ? eq(audit_logs.actor_user_id, query.actor_user_id) : undefined,
      query.enterprise_id ? eq(audit_logs.enterprise_id, query.enterprise_id) : undefined,
      query.module ? eq(audit_logs.module, query.module) : undefined,
      query.action ? eq(audit_logs.action, query.action) : undefined,
      query.resource_type ? eq(audit_logs.resource_type, query.resource_type) : undefined,
      query.resource_id ? eq(audit_logs.resource_id, query.resource_id) : undefined,
      query.from ? gte(audit_logs.occurred_at, new Date(query.from)) : undefined,
      query.to ? lte(audit_logs.occurred_at, new Date(query.to)) : undefined,
      cursorWhere(audit_logs.occurred_at, audit_logs.audit_id, query),
    ]);
    const rows = await this.db
      .select({ a: audit_logs, enterprise_name: enterprises.name })
      .from(audit_logs)
      .leftJoin(enterprises, eq(audit_logs.enterprise_id, enterprises.enterprise_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(audit_logs.occurred_at, audit_logs.audit_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.a.occurred_at, id: r.a.audit_id }), (r) => toView(r.a, r.enterprise_name));
  }

  @Get(':audit_id')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Chi tiết một bản ghi nhật ký', description: 'Kèm `old_values` / `new_values` đầy đủ để so sánh trước – sau.' })
  @ApiParam({ name: 'audit_id', format: 'uuid', example: EXAMPLE_AUDIT.audit_id })
  @ApiEnvelopeResponse({ description: 'Bản ghi.', example: EXAMPLE_AUDIT })
  @ApiAuthErrors() @ApiNotFoundError('nhật ký')
  async get(@Param('audit_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    const [row] = await this.db
      .select({ a: audit_logs, enterprise_name: enterprises.name })
      .from(audit_logs)
      .leftJoin(enterprises, eq(audit_logs.enterprise_id, enterprises.enterprise_id))
      .where(eq(audit_logs.audit_id, id))
      .limit(1);
    if (!row || !inScope(row.a.enterprise_id, actor.scope)) throw AppException.notFound('nhật ký', id);
    return toView(row.a, row.enterprise_name);
  }
}

function toView(a: typeof audit_logs.$inferSelect, enterprise_name: string | null): AuditLogView {
  return {
    audit_id: a.audit_id,
    enterprise_id: a.enterprise_id,
    enterprise_name,
    actor_user_id: a.actor_user_id,
    actor_username: a.actor_username,
    module: a.module,
    action: a.action,
    resource_type: a.resource_type,
    resource_id: a.resource_id,
    old_values: a.old_values,
    new_values: a.new_values,
    request_id: a.request_id,
    ip: a.ip,
    user_agent: a.user_agent,
    occurred_at: a.occurred_at.toISOString(),
  };
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, Public, RequirePermissions, SideEffect } from '../../common/decorators';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { ensureRequestId, requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeError, ApiEnvelopeResponse, ApiIdempotencyErrors, ApiNotFoundError, ApiStateConflict, ApiUnprocessable, ApiValidationError } from '../../common/swagger/api-envelope';
import { DeviceKeyGuard, type DeviceRequest } from './device-key.guard';
import { AllocateQuotaDto, GrantQuotaDto, ListAllocationsDto, ListQuotasDto, ListUsageDto, LockQuotaDto, RecordUsageDto, UpdateQuotaDto } from './dto/quota.dto';
import { EXAMPLE_ALLOCATION, EXAMPLE_GRANT, EXAMPLE_QUOTA_FULL, EXAMPLE_QUOTA_PAGE, EXAMPLE_USAGE, EXAMPLE_USAGE_PAGE } from './dto/quota.examples';
import { QuotaService } from './quota.service';

const ID = { name: 'device_id', format: 'uuid', example: EXAMPLE_QUOTA_FULL.device_id } as const;

@ApiTags('quota')
@ApiBearerAuth()
@Controller()
export class QuotaController {
  constructor(private readonly service: QuotaService) {}

  @Get('quotas')
  @RequirePermissions('quota.read')
  @ApiOperation({ summary: 'Sản lượng theo từng thiết bị', description: 'Cursor theo lần cập nhật gần nhất. Lọc `enterprise_id`, `is_locked`, `below_pct` (còn dưới N %), `q`. `remaining_pct = null` khi chưa cấp.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: EXAMPLE_QUOTA_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListQuotasDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Post('quotas/allocations')
  @HttpCode(201)
  @SideEffect()
  @RequirePermissions('quota.allocate')
  @ApiOperation({ summary: 'Phân bổ sản lượng từ doanh nghiệp cha xuống chi nhánh', description: 'Chuyển `amount` từ **máy của DN cha** (`from_device_id`) sang **máy của chi nhánh** (`device_id`): trừ tổng máy cho, cộng tổng máy nhận, ghi `quota_allocations`. `to_enterprise_id` phải là chi nhánh trực thuộc `from_enterprise_id`. Máy cho không đủ → 422. Bắt buộc `Idempotency-Key`. Khai TRƯỚC `quotas/{device_id}`.' })
  @ApiBody({ type: AllocateQuotaDto, examples: { pb: { value: { from_enterprise_id: EXAMPLE_ALLOCATION.from_enterprise_id, to_enterprise_id: EXAMPLE_ALLOCATION.to_enterprise_id, from_device_id: EXAMPLE_ALLOCATION.from_device_id, device_id: EXAMPLE_ALLOCATION.device_id, amount: 1000 } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã phân bổ.', example: EXAMPLE_ALLOCATION })
  @ApiValidationError() @ApiAuthErrors() @ApiIdempotencyErrors()
  @ApiUnprocessable('QUOTA_INSUFFICIENT', 'Máy cho không đủ sản lượng còn lại', '`details.remaining` < `details.requested`.', { remaining: 500, requested: 1000 })
  allocate(@Body() dto: AllocateQuotaDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.allocate(dto, { actor, ...requestMeta(req) });
  }

  @Get('quotas/allocations')
  @RequirePermissions('quota.read')
  @ApiOperation({ summary: 'Lịch sử phân bổ sản lượng', description: 'Lọc `from_enterprise_id`, `to_enterprise_id`, `device_id` (máy cho hoặc nhận), `from`/`to`. Người dùng DN thấy phân bổ mà DN mình là bên cho hoặc bên nhận.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_ALLOCATION], next_cursor: null } })
  @ApiValidationError() @ApiAuthErrors()
  allocations(@Query() query: ListAllocationsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.listAllocations(query, actor);
  }

  @Get('quotas/:device_id')
  @RequirePermissions('quota.read')
  @ApiOperation({ summary: 'Chi tiết sản lượng một thiết bị', description: 'Tổng / đã dùng / còn lại / % / ngưỡng / thời gian gói / khoá. Bất biến `quota_remaining = quota_total − quota_used`.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Sản lượng.', example: EXAMPLE_QUOTA_FULL })
  @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  get(@Param('device_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(id, actor);
  }

  @Put('quotas/:device_id')
  @RequirePermissions('quota.update')
  @ApiOperation({ summary: 'Sửa ngưỡng cảnh báo và thời gian gói', description: 'Chỉ admin hệ thống. `warn_threshold_pct` (mặc định 20), `package_start_at` / `package_end_at`. Hết `package_end_at` thì job khoá máy (`PACKAGE_EXPIRED`); gia hạn ở đây rồi mở khoá.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateQuotaDto, examples: { goi: { value: { package_end_at: '2027-06-30T00:00:00.000Z' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: { ...EXAMPLE_QUOTA_FULL, package_end_at: '2027-06-30T00:00:00.000Z' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  update(@Param('device_id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotaDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }

  @Post('quotas/:device_id/grants')
  @HttpCode(201)
  @SideEffect()
  @RequirePermissions('quota.grant')
  @ApiOperation({ summary: 'Cấp thêm sản lượng cho thiết bị', description: 'Cộng dồn vào tổng, ghi lịch sử `quota_grants` (append-only). Máy đang khoá vì **hết sản lượng** thì tự mở khoá; khoá tay (MANUAL) hay hết gói thì không. Bắt buộc `Idempotency-Key` — bấm hai lần không cấp hai lần.' })
  @ApiParam(ID)
  @ApiBody({ type: GrantQuotaDto, examples: { cap: { value: { amount: 5000, note: 'Gói bổ sung Q4/2026' } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Sản lượng sau khi cấp.', example: { ...EXAMPLE_QUOTA_FULL, quota_total: 15000, quota_remaining: 6750, remaining_pct: 45 } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị') @ApiIdempotencyErrors()
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Thiết bị đã kết thúc vòng đời', 'Máy EXCHANGED / RETIRED.', { current_status: 'RETIRED', attempted_action: 'GRANT' })
  grant(@Param('device_id', ParseUUIDPipe) id: string, @Body() dto: GrantQuotaDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.grant(id, dto, { actor, ...requestMeta(req) });
  }

  @Get('quotas/:device_id/grants')
  @RequirePermissions('quota.read')
  @ApiOperation({ summary: 'Lịch sử lượt cấp sản lượng', description: 'Cursor, mới nhất trước. `total_after` = tổng ngay sau lượt cấp — đối chiếu được với projection.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_GRANT], next_cursor: null } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  grants(@Param('device_id', ParseUUIDPipe) id: string, @Query() query: CursorPaginationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.listGrants(id, query, actor);
  }

  @Put('quotas/:device_id/lock')
  @RequirePermissions('quota.lock')
  @ApiOperation({ summary: 'Khoá thiết bị', description: '`ACTIVE → LOCKED`, `locked_reason = MANUAL`. Máy khoá gửi lượt dùng sẽ bị 422 `DEVICE_LOCKED` (vẫn ghi dòng rejected).' })
  @ApiParam(ID)
  @ApiBody({ type: LockQuotaDto, examples: { khoa: { value: { reason: 'Nợ phí gói tháng 9' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi khoá.', example: { ...EXAMPLE_QUOTA_FULL, device_status: 'LOCKED', is_locked: true, locked_reason: 'MANUAL' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Chỉ khoá được thiết bị đang hoạt động', 'Máy không ở ACTIVE.', { current_status: 'IN_STOCK', attempted_action: 'LOCK' })
  lock(@Param('device_id', ParseUUIDPipe) id: string, @Body() dto: LockQuotaDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.lock(id, dto, { actor, ...requestMeta(req) });
  }

  @Put('quotas/:device_id/unlock')
  @RequirePermissions('quota.lock')
  @ApiOperation({ summary: 'Mở khoá thiết bị', description: '`LOCKED → ACTIVE`. Từ chối (422) khi còn 0 sản lượng hoặc gói đã hết — cấp / gia hạn trước.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Sau khi mở.', example: EXAMPLE_QUOTA_FULL })
  @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Thiết bị không ở trạng thái khoá', 'Máy không ở LOCKED.', { current_status: 'ACTIVE', attempted_action: 'UNLOCK' })
  @ApiUnprocessable('QUOTA_INSUFFICIENT', 'Sản lượng còn 0 — cấp thêm trước khi mở khoá', 'Còn 0 hoặc hết gói.', { remaining: 0, requested: 1 })
  unlock(@Param('device_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.unlock(id, { actor, ...requestMeta(req) });
  }

  @Public()
  @UseGuards(DeviceKeyGuard)
  @Post('usage-logs')
  @HttpCode(201)
  @ApiHeader({ name: 'X-Device-Key', description: 'API key cấp cho thiết bị lúc assign', required: true })
  @ApiOperation({ summary: 'Thiết bị ghi nhận lượt sử dụng', description: 'Xác thực bằng `X-Device-Key` (không JWT). `device_id` trong body phải trùng máy của key — lệch → 403. **Idempotent** theo `(device_id, client_ref)`: gửi bù sau khi mất mạng không trừ hai lần — trùng thì 200 và trả lại bản cũ. Máy khoá → 422 `DEVICE_LOCKED`; không đủ → 422 `QUOTA_INSUFFICIENT`; cả hai vẫn ghi dòng `rejected = true`. Về 0 thì máy tự khoá `QUOTA_EXHAUSTED`. Cập nhật `last_seen_at`.' })
  @ApiBody({ type: RecordUsageDto, examples: { luot: { value: { device_id: EXAMPLE_USAGE.device_id, client_ref: EXAMPLE_USAGE.client_ref, amount: 1, used_at: EXAMPLE_USAGE.used_at } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã ghi và trừ. (200 khi trùng `client_ref` — trả bản cũ.)', example: EXAMPLE_USAGE })
  @ApiValidationError()
  @ApiEnvelopeError({ status: 401, code: 'AUTHENTICATION_FAILED', message: 'X-Device-Key không hợp lệ hoặc đã bị thu hồi', description: 'Thiếu / sai key, hoặc máy đã bị thu hồi (unassign xoá key).' })
  @ApiEnvelopeError({ status: 403, code: 'AUTHORIZATION_FAILED', message: 'device_id không khớp với khoá thiết bị', description: 'Key của máy A gửi lượt cho máy B.' })
  @ApiUnprocessable('DEVICE_LOCKED', 'Thiết bị đang bị khoá', 'Máy LOCKED hoặc hết gói. Đã ghi dòng rejected.', { status: 'LOCKED', locked_reason: 'QUOTA_EXHAUSTED' })
  @ApiUnprocessable('QUOTA_INSUFFICIENT', 'Sản lượng còn lại không đủ', 'Đã ghi dòng rejected.', { remaining: 0, requested: 1 })
  async recordUsage(@Body() dto: RecordUsageDto, @Req() req: DeviceRequest) {
    if (req.device_id !== dto.device_id) throw AppException.authorizationFailed('device_id không khớp với khoá thiết bị', { key_device_id: req.device_id });
    const { usage, replayed } = await this.service.recordUsage(dto, ensureRequestId(req));
    if (replayed) req.res?.status(200);
    return usage;
  }

  @Get('usage-logs')
  @RequirePermissions('usage.read')
  @ApiOperation({ summary: 'Danh sách lượt sử dụng', description: 'Cursor theo `used_at`. Lọc `device_id`, `enterprise_id`, `from`, `to`, `rejected`.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: EXAMPLE_USAGE_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  usage(@Query() query: ListUsageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.listUsage(query, actor);
  }
}

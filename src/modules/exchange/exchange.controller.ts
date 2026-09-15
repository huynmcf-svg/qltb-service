import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions, SideEffect } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiIdempotencyErrors, ApiNoContentResponse, ApiNotFoundError, ApiStateConflict, ApiValidationError } from '../../common/swagger/api-envelope';
import { ApproveExchangeDto, CreateExchangeDto, ListExchangesDto, RejectExchangeDto, UpdateExchangeDto } from './dto/exchange.dto';
import { EXAMPLE_EXCHANGE, EXAMPLE_EXCHANGE_APPROVED } from './dto/exchange.examples';
import { ExchangeService } from './exchange.service';

const ID = { name: 'exchange_id', format: 'uuid', example: EXAMPLE_EXCHANGE.exchange_id } as const;
const CONFLICT = ApiStateConflict('EXCHANGE_STATE_CONFLICT', 'Yêu cầu đổi trả không còn ở trạng thái chờ duyệt', 'Đã APPROVED / REJECTED, hoặc có người vừa xử lý.', { current_status: 'APPROVED' });

@ApiTags('device-exchanges')
@ApiBearerAuth()
@Controller('device-exchanges')
export class ExchangeController {
  constructor(private readonly service: ExchangeService) {}

  @Get()
  @RequirePermissions('exchange.read')
  @ApiOperation({ summary: 'Danh sách yêu cầu đổi trả', description: 'Cursor theo ngày tạo. Lọc `status`, `enterprise_id`. Người dùng DN chỉ thấy của DN mình + chi nhánh.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_EXCHANGE, EXAMPLE_EXCHANGE_APPROVED], next_cursor: null } })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListExchangesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Post()
  @HttpCode(201)
  @SideEffect()
  @RequirePermissions('exchange.request')
  @ApiOperation({ summary: 'Tạo yêu cầu đổi trả máy', description: 'Khai máy cũ (phải đang ACTIVE / LOCKED, thuộc DN của người gọi) và lý do. Mỗi máy chỉ **một** yêu cầu PENDING (409). `enterprise_id` lấy từ máy, không từ body. Bắt buộc `Idempotency-Key`.' })
  @ApiBody({ type: CreateExchangeDto, examples: { yc: { value: { old_device_id: EXAMPLE_EXCHANGE.old_device_id, reason: EXAMPLE_EXCHANGE.reason } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo, chờ duyệt.', example: EXAMPLE_EXCHANGE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị') @ApiIdempotencyErrors()
  @ApiStateConflict('EXCHANGE_STATE_CONFLICT', 'Máy này đã có yêu cầu đổi trả đang chờ duyệt', 'Một PENDING mỗi máy.', { old_device_id: EXAMPLE_EXCHANGE.old_device_id })
  create(@Body() dto: CreateExchangeDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, { actor, ...requestMeta(req) });
  }

  @Get(':exchange_id')
  @RequirePermissions('exchange.read')
  @ApiOperation({ summary: 'Chi tiết yêu cầu đổi trả', description: 'Kèm serial máy cũ / mới, tên người gửi / duyệt.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Yêu cầu.', example: EXAMPLE_EXCHANGE })
  @ApiAuthErrors() @ApiNotFoundError('yêu cầu đổi trả')
  get(@Param('exchange_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(id, actor);
  }

  @Put(':exchange_id')
  @RequirePermissions('exchange.request')
  @ApiOperation({ summary: 'Sửa yêu cầu khi chưa duyệt', description: '`reason`, `notes`. Chỉ khi PENDING.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateExchangeDto, examples: { sua: { value: { reason: 'Màn hình cảm ứng liệt, đã thử khởi động lại' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: EXAMPLE_EXCHANGE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('yêu cầu đổi trả')
  @CONFLICT
  update(@Param('exchange_id', ParseUUIDPipe) id: string, @Body() dto: UpdateExchangeDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':exchange_id/approve')
  @RequirePermissions('exchange.approve')
  @ApiOperation({ summary: 'Duyệt đổi trả, gán máy mới', description: 'Chỉ admin hệ thống. Một transaction: máy mới `IN_STOCK → ACTIVE` với DN đó (cấp API key mới — trả ở `api_key`, hiện một lần), máy cũ → `EXCHANGED`; bảo hành chuyển sang máy mới **giữ nguyên hạn** (`source = EXCHANGE`); **sản lượng còn lại chuyển sang máy mới** (ghi hai dòng đối ứng vào lịch sử).' })
  @ApiParam(ID)
  @ApiBody({ type: ApproveExchangeDto, examples: { duyet: { value: { new_device_id: EXAMPLE_EXCHANGE_APPROVED.new_device_id } } } })
  @ApiEnvelopeResponse({ description: 'Đã duyệt.', example: { ...EXAMPLE_EXCHANGE_APPROVED, api_key: 'qltbk_9kLm…' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('yêu cầu đổi trả')
  @CONFLICT
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Máy mới phải đang trong kho', 'Máy mới không ở IN_STOCK.', { current_status: 'ACTIVE', attempted_action: 'EXCHANGE_APPROVE' })
  approve(@Param('exchange_id', ParseUUIDPipe) id: string, @Body() dto: ApproveExchangeDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.approve(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':exchange_id/reject')
  @RequirePermissions('exchange.approve')
  @ApiOperation({ summary: 'Từ chối đổi trả', description: 'Kèm lý do. Máy cũ giữ nguyên trạng thái.' })
  @ApiParam(ID)
  @ApiBody({ type: RejectExchangeDto, examples: { tc: { value: { reject_reason: 'Lỗi do người dùng, không thuộc diện đổi trả' } } } })
  @ApiEnvelopeResponse({ description: 'Đã từ chối.', example: { ...EXAMPLE_EXCHANGE, status: 'REJECTED', reject_reason: 'Lỗi do người dùng, không thuộc diện đổi trả' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('yêu cầu đổi trả')
  @CONFLICT
  reject(@Param('exchange_id', ParseUUIDPipe) id: string, @Body() dto: RejectExchangeDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.reject(id, dto, { actor, ...requestMeta(req) });
  }

  @Delete(':exchange_id')
  @HttpCode(204)
  @RequirePermissions('exchange.request')
  @ApiOperation({ summary: 'Xoá yêu cầu chưa duyệt', description: 'Chỉ khi PENDING; chỉ người tạo hoặc admin hệ thống.' })
  @ApiParam(ID)
  @ApiNoContentResponse('Đã xoá.')
  @ApiAuthErrors() @ApiNotFoundError('yêu cầu đổi trả')
  @CONFLICT
  delete(@Param('exchange_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.delete(id, { actor, ...requestMeta(req) });
  }
}

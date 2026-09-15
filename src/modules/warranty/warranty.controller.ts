import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiNotFoundError, ApiUnprocessable, ApiValidationError } from '../../common/swagger/api-envelope';
import { CreateWarrantyDto, ExpiringWarrantiesDto, ListWarrantiesDto, UpdateWarrantyDto } from './dto/warranty.dto';
import { EXAMPLE_WARRANTY_FULL, EXAMPLE_WARRANTY_PAGE } from './dto/warranty.examples';
import { WarrantyService } from './warranty.service';

const ID = { name: 'warranty_id', format: 'uuid', example: EXAMPLE_WARRANTY_FULL.warranty_id } as const;

@ApiTags('warranties')
@ApiBearerAuth()
@Controller('warranties')
export class WarrantyController {
  constructor(private readonly service: WarrantyService) {}

  @Get()
  @RequirePermissions('warranty.read')
  @ApiOperation({ summary: 'Danh sách bảo hành', description: '**Sắp theo `end_date` tăng dần** — sắp hết hạn lên đầu. Lọc `status`, `enterprise_id`, `device_id`, `expiring_within_days` (chỉ ACTIVE còn ≤ N ngày), `q` (serial / tên máy). `days_remaining` âm = đã quá hạn nhưng job chưa đánh EXPIRED.' })
  @ApiEnvelopeResponse({ description: 'Một trang bảo hành.', example: EXAMPLE_WARRANTY_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListWarrantiesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Get('expiring')
  @RequirePermissions('warranty.read')
  @ApiOperation({ summary: 'Thiết bị sắp hết bảo hành', description: '`?days=30|15|7` (mặc định 30). Tối đa 200 dòng, sắp hết hạn trước. Khai TRƯỚC `/{warranty_id}` kẻo `expiring` bị hiểu là id.' })
  @ApiEnvelopeResponse({ description: 'Sắp hết hạn.', example: EXAMPLE_WARRANTY_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  expiring(@Query() query: ExpiringWarrantiesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.expiring(query.days ?? 30, actor);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('warranty.manage')
  @ApiOperation({ summary: 'Tạo lượt bảo hành', description: 'Đường bình thường là bảo hành tự tạo lúc `assign`. Endpoint này cho trường hợp đặc biệt (máy bán trước khi có hệ thống, gia hạn dạng lượt mới `EXTENSION`). Máy đang có lượt ACTIVE → 422, gia hạn bằng `PUT`.' })
  @ApiBody({ type: CreateWarrantyDto, examples: { tao: { value: { device_id: EXAMPLE_WARRANTY_FULL.device_id, start_date: '2026-01-15', end_date: '2027-01-15', source: 'SALE' } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo.', example: EXAMPLE_WARRANTY_FULL })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiUnprocessable('INVALID_PAYLOAD', 'Máy đang có bảo hành ACTIVE — gia hạn bằng PUT /warranties/{id} thay vì tạo mới', 'Một máy chỉ một lượt ACTIVE.')
  create(@Body() dto: CreateWarrantyDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, { actor, ...requestMeta(req) });
  }

  @Get(':warranty_id')
  @RequirePermissions('warranty.read')
  @ApiOperation({ summary: 'Chi tiết lượt bảo hành', description: 'Kèm serial và tên doanh nghiệp.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Bảo hành.', example: EXAMPLE_WARRANTY_FULL })
  @ApiAuthErrors() @ApiNotFoundError('bảo hành')
  get(@Param('warranty_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(id, actor);
  }

  @Put(':warranty_id')
  @RequirePermissions('warranty.manage')
  @ApiOperation({ summary: 'Sửa / gia hạn bảo hành', description: '`end_date` chỉ được dời **về sau** và chỉ với lượt ACTIVE; audit ghi `old_values.end_date`. `notes` sửa tự do.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateWarrantyDto, examples: { giahan: { value: { end_date: '2027-07-15', notes: 'Gia hạn 6 tháng theo HĐ phụ lục 02' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: { ...EXAMPLE_WARRANTY_FULL, end_date: '2027-07-15', days_remaining: 303 } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('bảo hành')
  update(@Param('warranty_id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarrantyDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }
}

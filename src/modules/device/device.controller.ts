import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ensureRequestId } from '../../common/request-context';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
  ApiNotFoundError,
  ApiValidationError,
} from '../../common/swagger/api-envelope';
import { DeviceService, type ActionContext } from './device.service';
import { CreateDeviceDto, ListDevicesDto, UpdateDeviceDto } from './dto/device.dto';
import {
  EXAMPLE_CREATE_DEVICE,
  EXAMPLE_DEVICE,
  EXAMPLE_DEVICE_PAGE,
  EXAMPLE_UPDATE_DEVICE,
} from './dto/device.examples';

/**
 * Route + map DTO. Không nghiệp vụ ở đây.
 *
 * Mọi endpoint có `summary` + `description` tiếng Việt và ví dụ bọc envelope —
 * `test/swagger.spec.ts` ép (docs/conventions.md mục "Swagger").
 */
@ApiTags('devices')
@Controller('devices')
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách thiết bị',
    description:
      'Phân trang **cursor**: truyền lại `next_cursor` của trang trước, không tự sinh. ' +
      'Sắp theo ngày tạo mới nhất trước. `q` tìm gần đúng trên `code` / `name` / ' +
      '`serial_number`, không phân biệt hoa thường.',
  })
  @ApiEnvelopeResponse({ description: 'Một trang thiết bị.', example: EXAMPLE_DEVICE_PAGE })
  @ApiValidationError()
  list(@Query() query: ListDevicesDto) {
    return this.service.list(query);
  }

  @Get(':device_id')
  @ApiOperation({
    summary: 'Chi tiết một thiết bị',
    description:
      '`status` và `holder_*` là trạng thái HIỆN TẠI, chiếu từ lịch sử. Muốn biết ' +
      'thiết bị đã qua tay ai thì gọi `/devices/{device_id}/history` (chưa có).',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiEnvelopeResponse({ description: 'Thiết bị.', example: EXAMPLE_DEVICE })
  @ApiNotFoundError('thiết bị')
  get(@Param('device_id', ParseUUIDPipe) device_id: string) {
    return this.service.get(device_id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Đăng ký thiết bị mới',
    description:
      'Thiết bị mới luôn vào `IN_STOCK`, đồng thời ghi một dòng `REGISTER` vào lịch sử ' +
      '— body **không** nhận `status` hay `holder_*`, cấp phát là thao tác riêng. ' +
      '`code` là mã in trên tem, unique và **không đổi được** sau khi tạo.',
  })
  @ApiBody({ type: CreateDeviceDto, examples: { 'laptop-dell': { value: EXAMPLE_CREATE_DEVICE } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo.', example: EXAMPLE_DEVICE })
  @ApiValidationError()
  @ApiEnvelopeError({
    status: 409,
    code: 'DEVICE_CODE_CONFLICT',
    message: 'Mã thiết bị đã tồn tại',
    description: 'Đã có thiết bị mang `code` này. Kiểm tra lại tem hoặc tra thiết bị cũ trước khi đổi mã.',
    details: { code: EXAMPLE_CREATE_DEVICE.code },
  })
  create(@Body() dto: CreateDeviceDto, @Req() req: Request) {
    return this.service.create(dto, contextOf(req));
  }

  @Patch(':device_id')
  @ApiOperation({
    summary: 'Sửa hồ sơ thiết bị',
    description:
      'Chỉ sửa được thông tin mô tả (tên, hãng, model, serial, ngày mua, ghi chú). ' +
      '**Không** đổi được `code`, `status`, `holder_*` qua đây — gửi các field đó là 400. ' +
      'Chỉ gửi field cần đổi; field không gửi giữ nguyên.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiBody({ type: UpdateDeviceDto, examples: { 'ghi-chu': { value: EXAMPLE_UPDATE_DEVICE } } })
  @ApiEnvelopeResponse({
    description: 'Thiết bị sau khi sửa.',
    example: { ...EXAMPLE_DEVICE, ...EXAMPLE_UPDATE_DEVICE },
  })
  @ApiValidationError()
  @ApiNotFoundError('thiết bị')
  update(
    @Param('device_id', ParseUUIDPipe) device_id: string,
    @Body() dto: UpdateDeviceDto,
    @Req() req: Request,
  ) {
    return this.service.update(device_id, dto, contextOf(req));
  }
}

/** Khi có auth, actor lấy từ `req.auth_user` — không bao giờ từ body. */
function contextOf(req: Request): ActionContext {
  return { request_id: ensureRequestId(req) };
}

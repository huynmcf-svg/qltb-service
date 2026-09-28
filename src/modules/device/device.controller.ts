import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, NoEnvelope, RequirePermissions } from '../../common/decorators';
import { AppException } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/request-context';
import {
  ApiAuthErrors,
  ApiEnvelopeError,
  ApiEnvelopeResponse,
  ApiNoContentResponse,
  ApiNotFoundError,
  ApiStateConflict,
  ApiUnprocessable,
  ApiValidationError,
} from '../../common/swagger/api-envelope';
import { QuotaService } from '../quota/quota.service';
import { EXAMPLE_USAGE_PAGE } from '../quota/dto/quota.examples';
import { WarrantyRepository } from '../warranty/warranty.repository';
import { EXAMPLE_WARRANTY_FULL } from '../warranty/dto/warranty.examples';
import { buildImportTemplate, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from './device-import';
import { DEVICE_TYPES } from './device-type.catalog';
import { DeviceService, type ActionContext } from './device.service';
import { AssignDeviceDto, ChangeDeviceStatusDto, CreateDeviceDto, ListDevicesDto, UnassignDeviceDto, UpdateDeviceDto, UsageRangeDto } from './dto/device.dto';
import {
  EXAMPLE_CREATE_DEVICE,
  EXAMPLE_DEVICE,
  EXAMPLE_DEVICE_DETAIL,
  EXAMPLE_DEVICE_IMPORT,
  EXAMPLE_DEVICE_PAGE,
  EXAMPLE_UPDATE_DEVICE,
} from './dto/device.examples';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Phần của file multer cần dùng — tránh kéo thêm `@types/multer`. */
interface UploadedXlsx {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * Route + map DTO. Không nghiệp vụ ở đây. Đặc tả dùng PUT cho sửa (không PATCH).
 *
 * Mọi endpoint có `summary` + `description` tiếng Việt và ví dụ bọc envelope —
 * `test/swagger.spec.ts` ép (docs/conventions.md mục "Swagger").
 */
@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly service: DeviceService,
    private readonly quotas: QuotaService,
    private readonly warranties: WarrantyRepository,
  ) {}

  @Get('types')
  @RequirePermissions('device.read')
  @ApiOperation({ summary: 'Danh mục loại thiết bị', description: 'Cố định trong code (`device-type.catalog.ts`) cho tới khi đặc tả chốt. Web dựng select từ đây. Khai TRƯỚC `/:device_id` kẻo `types` bị hiểu là id.' })
  @ApiEnvelopeResponse({ description: 'Danh mục.', example: { items: DEVICE_TYPES } })
  @ApiAuthErrors()
  types() {
    return { items: DEVICE_TYPES };
  }

  @Get('import-template')
  @NoEnvelope()
  @RequirePermissions('device.create')
  @ApiProduces(XLSX)
  @ApiOperation({
    summary: 'Tải file Excel mẫu nhập thiết bị',
    description:
      'Trả file `.xlsx` (`Content-Disposition: attachment`), **không envelope**. Sheet `Thiết bị` chỉ có dòng tiêu đề ' +
      '(cột có `(*)` là bắt buộc, mỗi tiêu đề có ghi chú cách điền); sheet `Loại thiết bị` là danh mục mã; sheet `Hướng dẫn` ' +
      'giải thích từng cột. Người dùng điền rồi đẩy lên `POST /devices/import`. Khai TRƯỚC `/:device_id`.',
  })
  @ApiResponse({ status: 200, description: 'File mẫu.', content: { [XLSX]: { example: '(file .xlsx)' } } })
  @ApiAuthErrors()
  async importTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-thiet-bi.xlsx"');
    await buildImportTemplate().xlsx.write(res);
    res.end();
  }

  @Post('import')
  @HttpCode(201)
  @RequirePermissions('device.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Nhập thiết bị hàng loạt từ file Excel',
    description:
      '`multipart/form-data`, field `file` = file `.xlsx` theo mẫu `GET /devices/import-template` (tối đa 2 MB, ' +
      `${IMPORT_MAX_ROWS} dòng). Cột nhận theo **tiêu đề**, không theo vị trí; dòng trống bỏ qua. **Tất cả hoặc không**: ` +
      'có một dòng sai là 422 `INVALID_PAYLOAD` với `details.errors = [{ row, column, message }]` (số dòng như Excel hiển thị), ' +
      'không lưu dòng nào. Dòng không có `Mã khách hàng` → máy `IN_STOCK`; có → gán luôn cho doanh nghiệp đó (`ACTIVE`, ' +
      'bảo hành `SALE`) nhưng **không cấp API key** — cấp ở `POST /devices/{id}/api-key`.',
  })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'File .xlsx theo mẫu' } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã nhập.', example: EXAMPLE_DEVICE_IMPORT })
  @ApiEnvelopeError({ status: 400, code: 'INVALID_PAYLOAD', message: 'Thiếu cột bắt buộc: Serial. Hãy dùng đúng file mẫu', description: 'Không có file, file không phải .xlsx, thiếu cột bắt buộc, quá số dòng, hoặc không có dòng dữ liệu.', details: { missing_columns: ['Serial'] } })
  @ApiAuthErrors()
  @ApiUnprocessable('INVALID_PAYLOAD', 'File có 2 lỗi — chưa lưu dòng nào, sửa rồi đẩy lại', 'Có dòng sai. Danh sách lỗi (tối đa 200) ở `details.errors`.', {
    error_count: 2,
    errors: [
      { row: 3, column: 'Serial', message: 'Serial đã có trong hệ thống' },
      { row: 7, column: 'Mã khách hàng', message: 'Không có doanh nghiệp mã "DN999"' },
    ],
  })
  @ApiEnvelopeError({ status: 409, code: 'DEVICE_SERIAL_CONFLICT', message: 'Có serial vừa được nhập bởi người khác — tải lại danh sách rồi thử lại', description: 'Hiếm: serial bị nhập song song giữa lúc kiểm và lúc ghi. Không dòng nào được lưu.', details: {} })
  importDevices(@UploadedFile() file: UploadedXlsx | undefined, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    if (!file?.buffer?.length) throw AppException.invalidPayload('Chưa chọn file — gửi field `file` dạng multipart/form-data', { violations: ['file'] });
    return this.service.importDevices(file.buffer, contextOf(actor, req));
  }

  @Get()
  @RequirePermissions('device.read')
  @ApiOperation({
    summary: 'Danh sách thiết bị',
    description:
      'Phân trang **cursor**: truyền lại `next_cursor` của trang trước, không tự sinh. ' +
      'Sắp theo ngày nhập kho mới nhất trước. `q` tìm gần đúng trên `serial_number` / ' +
      '`name` / `model`; `supplier_name` lọc gần đúng theo nhà cung cấp. `is_online` suy từ `last_seen_at` trong 24 h — không phải một `status`. ' +
      'Khi có auth, danh sách tự lọc theo doanh nghiệp của người gọi và chi nhánh con.',
  })
  @ApiEnvelopeResponse({ description: 'Một trang thiết bị.', example: EXAMPLE_DEVICE_PAGE })
  @ApiValidationError()
  @ApiAuthErrors()
  list(@Query() query: ListDevicesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Get(':device_id')
  @RequirePermissions('device.read')
  @ApiOperation({
    summary: 'Chi tiết thiết bị kèm sản lượng và bảo hành',
    description:
      'Trả thêm `quota` (projection sản lượng: tổng / đã dùng / còn lại / khoá) và `warranty` ' +
      '(lượt bảo hành đang `ACTIVE`, `null` nếu chưa bán hoặc đã hết). Máy vừa nhập kho có ' +
      '`quota` toàn 0 và `remaining_pct = null` — chưa cấp thì không có phần trăm để tính.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiEnvelopeResponse({ description: 'Thiết bị.', example: EXAMPLE_DEVICE_DETAIL })
  @ApiAuthErrors()
  @ApiNotFoundError('thiết bị')
  get(@Param('device_id', ParseUUIDPipe) device_id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(device_id, actor);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('device.create')
  @ApiOperation({
    summary: 'Nhập thiết bị vào kho',
    description:
      'Máy mới luôn `IN_STOCK`, chưa thuộc doanh nghiệp nào, và tự có một dòng `device_quotas` ' +
      'rỗng. Body **không** nhận `status` / `enterprise_id` — gán cho doanh nghiệp là ' +
      '`PUT /devices/{id}/assign`. `serial_number` là định danh nhà máy, unique và **không đổi được**.',
  })
  @ApiBody({ type: CreateDeviceDto, examples: { signpad: { value: EXAMPLE_CREATE_DEVICE } } })
  @ApiEnvelopeResponse({
    status: 201,
    description: 'Đã nhập kho.',
    example: { ...EXAMPLE_DEVICE_DETAIL, ...EXAMPLE_DEVICE, quota: { ...EXAMPLE_DEVICE_DETAIL.quota, quota_total: 0, quota_used: 0, quota_remaining: 0, remaining_pct: null, package_start_at: null, package_end_at: null }, warranty: null },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiEnvelopeError({
    status: 409,
    code: 'DEVICE_SERIAL_CONFLICT',
    message: 'Serial thiết bị đã tồn tại',
    description: 'Đã có máy mang `serial_number` này. Tra máy cũ trước khi nhập lại — có thể là máy đổi trả quay về kho.',
    details: { serial_number: EXAMPLE_CREATE_DEVICE.serial_number },
  })
  create(@Body() dto: CreateDeviceDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, contextOf(actor, req));
  }

  @Put(':device_id')
  @RequirePermissions('device.update')
  @ApiOperation({
    summary: 'Sửa hồ sơ thiết bị',
    description:
      'Chỉ sửa thông tin mô tả (`model`, `name`, `firmware_version`, `supplier_name`, `notes`). **Không** đổi ' +
      '`serial_number`, `status`, `enterprise_id` qua đây — gửi các field đó là 400. ' +
      'Chỉ gửi field cần đổi; field không gửi giữ nguyên.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiBody({ type: UpdateDeviceDto, examples: { firmware: { value: EXAMPLE_UPDATE_DEVICE } } })
  @ApiEnvelopeResponse({
    description: 'Thiết bị sau khi sửa.',
    example: { ...EXAMPLE_DEVICE_DETAIL, ...EXAMPLE_UPDATE_DEVICE },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFoundError('thiết bị')
  update(
    @Param('device_id', ParseUUIDPipe) device_id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.update(device_id, dto, contextOf(actor, req));
  }

  @Put(':device_id/assign')
  @RequirePermissions('device.assign')
  @ApiOperation({
    summary: 'Gán thiết bị cho doanh nghiệp',
    description:
      '`IN_STOCK → ACTIVE`. Ghi `sold_at` (mặc định hôm nay), tạo bảo hành `SALE` dài `warranty_months` ' +
      'tháng (mặc định 12, 0 = không tạo), và cấp **API key** cho thiết bị — trả ở `api_key`, hiện **MỘT LẦN**, ' +
      'nạp vào máy để gọi `POST /usage-logs`. Mất key thì `POST /devices/{id}/api-key` cấp lại. Chỉ admin hệ thống.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiBody({ type: AssignDeviceDto, examples: { ban: { value: { enterprise_id: EXAMPLE_DEVICE_DETAIL.enterprise_id, sold_at: '2026-01-15', warranty_months: 12 } } } })
  @ApiEnvelopeResponse({ description: 'Đã gán. `api_key` chỉ xuất hiện ở response này.', example: { ...EXAMPLE_DEVICE_DETAIL, api_key: 'qltbk_3fJx9…' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Chỉ gán được thiết bị đang trong kho', 'Máy không ở `IN_STOCK`.', { current_status: 'ACTIVE', attempted_action: 'ASSIGN' })
  assign(@Param('device_id', ParseUUIDPipe) device_id: string, @Body() dto: AssignDeviceDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.assign(device_id, dto, contextOf(actor, req));
  }

  @Put(':device_id/unassign')
  @RequirePermissions('device.assign')
  @ApiOperation({
    summary: 'Thu hồi thiết bị khỏi doanh nghiệp',
    description:
      '`ACTIVE | LOCKED → IN_STOCK`. Xoá `enterprise_id`, thu hồi API key (máy ngoài hiện trường không gửi được lượt nữa), ' +
      'bảo hành đang `ACTIVE` chuyển `VOID`. **Sản lượng còn lại giữ nguyên trên máy** — gán lại cho DN khác là dùng tiếp.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiBody({ type: UnassignDeviceDto, examples: { thuhoi: { value: { reason: 'Hết hợp đồng' } } } })
  @ApiEnvelopeResponse({ description: 'Đã thu hồi.', example: { ...EXAMPLE_DEVICE_DETAIL, ...EXAMPLE_DEVICE, warranty: null } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Thiết bị chưa được gán cho doanh nghiệp nào', 'Máy đang `IN_STOCK` / `EXCHANGED` / `RETIRED`.', { current_status: 'IN_STOCK', attempted_action: 'UNASSIGN' })
  unassign(@Param('device_id', ParseUUIDPipe) device_id: string, @Body() dto: UnassignDeviceDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.unassign(device_id, dto, contextOf(actor, req));
  }

  @Put(':device_id/status')
  @RequirePermissions('device.status')
  @ApiOperation({
    summary: 'Đổi trạng thái thiết bị tay',
    description:
      'Chỉ ba đích: `LOCKED` (từ ACTIVE — khoá tay, `locked_reason = MANUAL`), `ACTIVE` (từ LOCKED — mở khoá, ' +
      'đòi còn sản lượng), `RETIRED` (từ IN_STOCK — thanh lý, không quay lại). Gán / thu hồi dùng endpoint riêng.',
  })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiBody({ type: ChangeDeviceStatusDto, examples: { khoa: { value: { status: 'LOCKED', reason: 'Khoá theo yêu cầu kế toán' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi đổi.', example: { ...EXAMPLE_DEVICE_DETAIL, status: 'LOCKED', quota: { ...EXAMPLE_DEVICE_DETAIL.quota, is_locked: true, locked_reason: 'MANUAL', locked_at: EXAMPLE_DEVICE_DETAIL.updated_at } } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Chỉ khoá được thiết bị đang hoạt động', 'Chuyển không hợp lệ theo máy trạng thái.', { current_status: 'IN_STOCK', attempted_action: 'LOCK' })
  @ApiUnprocessable('QUOTA_INSUFFICIENT', 'Sản lượng còn 0 — cấp thêm trước khi mở khoá', 'Mở khoá máy đã hết sản lượng.', { remaining: 0, requested: 1 })
  changeStatus(@Param('device_id', ParseUUIDPipe) device_id: string, @Body() dto: ChangeDeviceStatusDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.changeStatus(device_id, dto, contextOf(actor, req));
  }

  @Post(':device_id/api-key')
  @HttpCode(200)
  @RequirePermissions('device.assign')
  @ApiOperation({ summary: 'Cấp lại API key cho thiết bị', description: 'Key cũ chết ngay. Chỉ máy đang gán (ACTIVE / LOCKED). Key hiện **một lần**.' })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiEnvelopeResponse({ description: 'Key mới.', example: { api_key: 'qltbk_3fJx9…' } })
  @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiStateConflict('DEVICE_STATE_CONFLICT', 'Chỉ cấp API key cho máy đang gán', 'Máy chưa gán.', { current_status: 'IN_STOCK', attempted_action: 'ROTATE_API_KEY' })
  rotateApiKey(@Param('device_id', ParseUUIDPipe) device_id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.rotateApiKey(device_id, contextOf(actor, req));
  }

  @Get(':device_id/usage')
  @RequirePermissions('usage.read')
  @ApiOperation({ summary: 'Lịch sử lượt sử dụng của thiết bị', description: 'Cursor, mới nhất trước, lọc `from` / `to` theo `used_at` (giờ thiết bị). Gồm cả lượt `rejected`.' })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiEnvelopeResponse({ description: 'Một trang lượt dùng.', example: EXAMPLE_USAGE_PAGE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  async usage(@Param('device_id', ParseUUIDPipe) device_id: string, @Query() query: UsageRangeDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.service.get(device_id, actor);
    return this.quotas.listUsage({ ...query, device_id }, actor);
  }

  @Get(':device_id/warranties')
  @RequirePermissions('warranty.read')
  @ApiOperation({ summary: 'Lịch sử bảo hành của thiết bị', description: 'Toàn bộ các lượt (SALE / EXTENSION / EXCHANGE), mới nhất trước. Lượt `ACTIVE` cũng có ở `GET /devices/{id}`.' })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiEnvelopeResponse({ description: 'Lịch sử bảo hành.', example: { items: [EXAMPLE_WARRANTY_FULL] } })
  @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  async warrantiesOf(@Param('device_id', ParseUUIDPipe) device_id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.service.get(device_id, actor);
    return { items: await this.warranties.historyOfDevice(device_id) };
  }

  @Delete(':device_id')
  @HttpCode(204)
  @RequirePermissions('device.delete')
  @ApiOperation({ summary: 'Xoá thiết bị', description: 'Chỉ máy `IN_STOCK` **chưa có** lịch sử sản lượng; máy đã dùng thì thanh lý (`RETIRED`) — lịch sử append-only không xoá được.' })
  @ApiParam({ name: 'device_id', format: 'uuid', example: EXAMPLE_DEVICE.device_id })
  @ApiNoContentResponse('Đã xoá.')
  @ApiAuthErrors() @ApiNotFoundError('thiết bị')
  @ApiUnprocessable('DEVICE_STATE_CONFLICT', 'Chỉ xoá được máy trong kho — dùng thanh lý (RETIRED) cho máy đã dùng', 'Máy không ở IN_STOCK hoặc đã có lịch sử.', { current_status: 'ACTIVE' })
  delete(@Param('device_id', ParseUUIDPipe) device_id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.delete(device_id, contextOf(actor, req));
  }
}

/** Actor lấy từ token (`req.auth_user`), không bao giờ từ body. */
function contextOf(actor: AuthenticatedUser, req: Request): ActionContext {
  return { actor, ...requestMeta(req) };
}

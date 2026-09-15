import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeError, ApiEnvelopeResponse, ApiNoContentResponse, ApiNotFoundError, ApiUnprocessable, ApiValidationError } from '../../common/swagger/api-envelope';
import { DeviceService } from '../device/device.service';
import { ListDevicesDto } from '../device/dto/device.dto';
import { EXAMPLE_DEVICE_PAGE } from '../device/dto/device.examples';
import { ListUsersDto } from '../user/dto/user.dto';
import { EXAMPLE_USER_PAGE } from '../user/dto/user.examples';
import { UserService } from '../user/user.service';
import { ChangeEnterpriseStatusDto, CreateEnterpriseDto, ListEnterprisesDto, UpdateEnterpriseDto } from './dto/enterprise.dto';
import { EXAMPLE_BRANCH, EXAMPLE_CREATE_ENTERPRISE, EXAMPLE_ENTERPRISE, EXAMPLE_ENTERPRISE_PAGE } from './dto/enterprise.examples';
import { EnterpriseService } from './enterprise.service';

const ID = { name: 'enterprise_id', format: 'uuid', example: EXAMPLE_ENTERPRISE.enterprise_id } as const;

@ApiTags('enterprises')
@ApiBearerAuth()
@Controller('enterprises')
export class EnterpriseController {
  constructor(
    private readonly service: EnterpriseService,
    private readonly devices: DeviceService,
    private readonly users: UserService,
  ) {}

  @Get()
  @RequirePermissions('enterprise.read')
  @ApiOperation({ summary: 'Danh sách doanh nghiệp', description: 'Cursor. Người dùng DN chỉ thấy DN mình và chi nhánh. `parent_id=null` (chuỗi) lọc doanh nghiệp gốc; `parent_id=<uuid>` lọc chi nhánh của DN đó. `user_count` / `device_count` / `branch_count` tính lúc gọi, không cache.' })
  @ApiEnvelopeResponse({ description: 'Một trang doanh nghiệp.', example: EXAMPLE_ENTERPRISE_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListEnterprisesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('enterprise.create')
  @ApiOperation({ summary: 'Thêm doanh nghiệp', description: 'Chỉ quản trị hệ thống. `parent_id` để tạo chi nhánh — **tối đa 2 cấp**, chi nhánh không có chi nhánh (422). `max_users` mặc định 10 — hạn mức tài khoản miễn phí.' })
  @ApiBody({ type: CreateEnterpriseDto, examples: { vpcc: { value: EXAMPLE_CREATE_ENTERPRISE } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo.', example: { ...EXAMPLE_ENTERPRISE, user_count: 0, device_count: 0, branch_count: 0 } })
  @ApiValidationError() @ApiAuthErrors()
  @ApiEnvelopeError({ status: 409, code: 'ENTERPRISE_CODE_CONFLICT', message: 'Mã doanh nghiệp đã tồn tại', description: 'Đã có DN mang `code` này.', details: { code: 'VPCC-DA' } })
  @ApiUnprocessable('INVALID_PAYLOAD', 'Chi nhánh không thể có chi nhánh con — tối đa 2 cấp', '`parent_id` trỏ vào một chi nhánh.')
  create(@Body() dto: CreateEnterpriseDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, { actor, ...requestMeta(req) });
  }

  @Get(':enterprise_id')
  @RequirePermissions('enterprise.read')
  @ApiOperation({ summary: 'Chi tiết doanh nghiệp', description: 'Ngoài phạm vi → 404 (không 403, để không xác nhận id tồn tại).' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Doanh nghiệp.', example: EXAMPLE_ENTERPRISE })
  @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  get(@Param('enterprise_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(id, actor);
  }

  @Put(':enterprise_id')
  @RequirePermissions('enterprise.update')
  @ApiOperation({ summary: 'Sửa thông tin doanh nghiệp', description: 'Không đổi `code`, `parent_id`. Quản trị DN sửa được hồ sơ DN mình nhưng **không** đổi `max_users` (403) — đó là hạn mức nhà cung cấp đặt.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateEnterpriseDto, examples: { lienhe: { value: { contact_name: 'Trần Thị B', phone: '+84912345678' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: { ...EXAMPLE_ENTERPRISE, contact_name: 'Trần Thị B', phone: '+84912345678' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  update(@Param('enterprise_id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnterpriseDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':enterprise_id/status')
  @RequirePermissions('enterprise.status')
  @ApiOperation({ summary: 'Đổi trạng thái hoạt động', description: '`SUSPENDED` áp cho **cả chi nhánh con**; mọi người dùng của DN mất đường vào ngay (guard nạp lại mỗi request). Thiết bị vẫn giữ nguyên trạng thái. `ACTIVE` mở lại cả cây.' })
  @ApiParam(ID)
  @ApiBody({ type: ChangeEnterpriseStatusDto, examples: { dinhchi: { value: { status: 'SUSPENDED', reason: 'Nợ phí quá hạn' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi đổi.', example: { ...EXAMPLE_ENTERPRISE, status: 'SUSPENDED' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  changeStatus(@Param('enterprise_id', ParseUUIDPipe) id: string, @Body() dto: ChangeEnterpriseStatusDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.changeStatus(id, dto, { actor, ...requestMeta(req) });
  }

  @Get(':enterprise_id/branches')
  @RequirePermissions('enterprise.read')
  @ApiOperation({ summary: 'Chi nhánh con', description: 'Toàn bộ, không phân trang (một DN có vài chi nhánh). Sắp theo tên.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Danh sách chi nhánh.', example: { items: [EXAMPLE_BRANCH] } })
  @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  async branches(@Param('enterprise_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return { items: await this.service.branches(id, actor) };
  }

  @Get(':enterprise_id/users')
  @RequirePermissions('enterprise.read', 'user.read')
  @ApiOperation({ summary: 'Người dùng thuộc doanh nghiệp', description: 'Tương đương `GET /users?enterprise_id=…`, chỉ DN này (không gồm chi nhánh).' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Một trang người dùng.', example: EXAMPLE_USER_PAGE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  async usersOf(@Param('enterprise_id', ParseUUIDPipe) id: string, @Query() query: ListUsersDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.service.get(id, actor);
    return this.users.list({ ...query, enterprise_id: id }, actor);
  }

  @Get(':enterprise_id/devices')
  @RequirePermissions('enterprise.read', 'device.read')
  @ApiOperation({ summary: 'Thiết bị doanh nghiệp đang sở hữu', description: 'Tương đương `GET /devices?enterprise_id=…`.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Một trang thiết bị.', example: EXAMPLE_DEVICE_PAGE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  async devicesOf(@Param('enterprise_id', ParseUUIDPipe) id: string, @Query() query: ListDevicesDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.service.get(id, actor);
    return this.devices.list({ ...query, enterprise_id: id }, actor);
  }

  @Delete(':enterprise_id')
  @HttpCode(204)
  @RequirePermissions('enterprise.delete')
  @ApiOperation({ summary: 'Xoá doanh nghiệp', description: 'Chỉ khi **không còn** thiết bị, người dùng, chi nhánh, và không có lịch sử (bảo hành, phân bổ) trỏ tới — ngược lại 422, dùng `SUSPENDED` thay vì xoá.' })
  @ApiParam(ID)
  @ApiNoContentResponse('Đã xoá.')
  @ApiAuthErrors() @ApiNotFoundError('doanh nghiệp')
  @ApiUnprocessable('INVALID_PAYLOAD', 'Doanh nghiệp còn thiết bị, người dùng hoặc chi nhánh — thu hồi / xoá trước', 'Còn ràng buộc. `details` nêu số lượng từng loại.', { device_count: 3, user_count: 1, branch_count: 0 })
  delete(@Param('enterprise_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.delete(id, { actor, ...requestMeta(req) });
  }
}

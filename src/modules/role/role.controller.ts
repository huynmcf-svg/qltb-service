import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiNoContentResponse, ApiNotFoundError, ApiUnprocessable, ApiValidationError } from '../../common/swagger/api-envelope';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import { EXAMPLE_CUSTOM_ROLE, EXAMPLE_PERMISSIONS, EXAMPLE_ROLE } from './dto/role.examples';
import { RoleService } from './role.service';

const ID = { name: 'role_id', format: 'uuid', example: EXAMPLE_ROLE.role_id } as const;

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RoleController {
  constructor(private readonly service: RoleService) {}

  @Get('roles')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'Danh sách vai trò', description: 'Toàn bộ, không phân trang. Vai trò dùng chung toàn hệ thống. `user_count` = số người đang gán. `is_system` = vai trò seed, không sửa / xoá được.' })
  @ApiEnvelopeResponse({ description: 'Danh sách vai trò.', example: { items: [EXAMPLE_ROLE, EXAMPLE_CUSTOM_ROLE] } })
  @ApiAuthErrors()
  async list() {
    return { items: await this.service.list() };
  }

  @Post('roles')
  @HttpCode(201)
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Tạo vai trò', description: 'Chỉ quản trị hệ thống. `permission_codes` lấy từ `GET /permissions`; mã lạ → 400.' })
  @ApiBody({ type: CreateRoleDto, examples: { chinhanh: { value: { code: 'BRANCH_MANAGER', name: 'Trưởng chi nhánh', description: 'Xem và tạo yêu cầu đổi trả', permission_codes: EXAMPLE_CUSTOM_ROLE.permissions } } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo.', example: EXAMPLE_CUSTOM_ROLE })
  @ApiValidationError() @ApiAuthErrors()
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, { actor, ...requestMeta(req) });
  }

  @Get('roles/:role_id')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'Chi tiết vai trò', description: 'Kèm mảng `permissions` (mã quyền).' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Vai trò.', example: EXAMPLE_ROLE })
  @ApiAuthErrors() @ApiNotFoundError('vai trò')
  get(@Param('role_id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Put('roles/:role_id')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Sửa vai trò', description: '`name`, `description`. Vai trò `is_system` → 403.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateRoleDto, examples: { ten: { value: { name: 'Trưởng chi nhánh (mới)' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: { ...EXAMPLE_CUSTOM_ROLE, name: 'Trưởng chi nhánh (mới)' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('vai trò')
  update(@Param('role_id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }

  @Get('roles/:role_id/permissions')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'Quyền của vai trò', description: 'Mảng mã quyền kèm tên / nhóm.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Quyền của vai trò.', example: EXAMPLE_PERMISSIONS })
  @ApiAuthErrors() @ApiNotFoundError('vai trò')
  async permissionsOf(@Param('role_id', ParseUUIDPipe) id: string) {
    const role = await this.service.get(id);
    const all = await this.service.permissions();
    return { items: all.filter((p) => role.permissions.includes(p.code)) };
  }

  @Put('roles/:role_id/permissions')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Cập nhật quyền của vai trò', description: '**Thay thế** toàn bộ. Có hiệu lực ngay với mọi người đang mang vai trò (guard nạp quyền từ DB mỗi request). Vai trò `is_system` → 403: tạo vai trò mới thay vì sửa bộ mặc định.' })
  @ApiParam(ID)
  @ApiBody({ type: SetRolePermissionsDto, examples: { quyen: { value: { permission_codes: EXAMPLE_CUSTOM_ROLE.permissions } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi cập nhật.', example: EXAMPLE_CUSTOM_ROLE })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('vai trò')
  setPermissions(@Param('role_id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.setPermissions(id, dto, { actor, ...requestMeta(req) });
  }

  @Delete('roles/:role_id')
  @HttpCode(204)
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Xoá vai trò', description: 'Chỉ khi không còn người dùng nào gán (422). Vai trò hệ thống → 403.' })
  @ApiParam(ID)
  @ApiNoContentResponse('Đã xoá.')
  @ApiAuthErrors() @ApiNotFoundError('vai trò')
  @ApiUnprocessable('INVALID_PAYLOAD', 'Vai trò còn người dùng đang gán', 'Gỡ vai trò khỏi người dùng trước.', { user_count: 3 })
  delete(@Param('role_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.delete(id, { actor, ...requestMeta(req) });
  }

  @Get('permissions')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'Toàn bộ quyền của hệ thống', description: 'Danh mục cố định seed từ `permission.catalog.ts`, sắp theo `group` rồi `code`. Web dùng để dựng ma trận tick chọn.' })
  @ApiEnvelopeResponse({ description: 'Danh mục quyền.', example: EXAMPLE_PERMISSIONS })
  @ApiAuthErrors()
  async permissions() {
    return { items: await this.service.permissions() };
  }
}

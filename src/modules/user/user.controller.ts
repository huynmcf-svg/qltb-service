import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import { ApiAuthErrors, ApiEnvelopeError, ApiEnvelopeResponse, ApiNoContentResponse, ApiNotFoundError, ApiUnprocessable, ApiValidationError } from '../../common/swagger/api-envelope';
import { AssignRolesDto, CreateUserDto, DisableUserDto, ListUsersDto, ResetPasswordByAdminDto, UpdateUserDto } from './dto/user.dto';
import { EXAMPLE_CREATE_USER, EXAMPLE_ROLE_REF, EXAMPLE_USER, EXAMPLE_USER_PAGE } from './dto/user.examples';
import { UserService } from './user.service';

const ID = { name: 'user_id', format: 'uuid', example: EXAMPLE_USER.user_id } as const;

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  @RequirePermissions('user.read')
  @ApiOperation({ summary: 'Danh sách người dùng', description: 'Cursor. Người dùng DN chỉ thấy DN mình + chi nhánh. Lọc `enterprise_id`, `role_code`, `status`, `q` (username / họ tên / email). Tài khoản đã xoá (soft delete) không hiện.' })
  @ApiEnvelopeResponse({ description: 'Một trang người dùng.', example: EXAMPLE_USER_PAGE })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListUsersDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('user.create')
  @ApiOperation({ summary: 'Tạo tài khoản', description: 'Kiểm hạn mức `max_users` của DN (422 `ENTERPRISE_USER_LIMIT`). Không gửi `password` thì server sinh và trả **một lần** ở `temporary_password` — người dùng bắt buộc đổi ở lần đăng nhập đầu (`must_change_password`). Quản trị DN không gán được `SYSTEM_ADMIN` (403) và không tạo được tài khoản không thuộc DN nào.' })
  @ApiBody({ type: CreateUserDto, examples: { ketoan: { value: EXAMPLE_CREATE_USER } } })
  @ApiEnvelopeResponse({ status: 201, description: 'Đã tạo. `temporary_password` chỉ có khi server sinh mật khẩu.', example: { ...EXAMPLE_USER, must_change_password: true, last_login_at: null, temporary_password: 'Xk9pQ2mZ7vLw' } })
  @ApiValidationError() @ApiAuthErrors()
  @ApiEnvelopeError({ status: 409, code: 'USERNAME_CONFLICT', message: 'Tên đăng nhập đã tồn tại', description: 'Đã có tài khoản mang `username` này.', details: { username: 'ketoan.dongdanh' } })
  @ApiUnprocessable('ENTERPRISE_USER_LIMIT', 'Doanh nghiệp đã đủ 10 tài khoản', 'Vượt `max_users`. Nâng hạn mức ở `PUT /enterprises/{id}` (chỉ admin hệ thống).', { max_users: 10, current: 10 })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.create(dto, { actor, ...requestMeta(req) });
  }

  @Get(':user_id')
  @RequirePermissions('user.read')
  @ApiOperation({ summary: 'Chi tiết người dùng', description: 'Ngoài phạm vi DN → 404.' })
  @ApiParam(ID)
  @ApiEnvelopeResponse({ description: 'Người dùng.', example: EXAMPLE_USER })
  @ApiAuthErrors() @ApiNotFoundError('người dùng')
  get(@Param('user_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.get(id, actor);
  }

  @Put(':user_id')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Sửa thông tin người dùng', description: 'Chỉ `full_name`, `email`, `phone`. Không đổi `username`, doanh nghiệp. Vai trò đổi ở `/users/{id}/roles`.' })
  @ApiParam(ID)
  @ApiBody({ type: UpdateUserDto, examples: { sdt: { value: { phone: '+84987654321' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi sửa.', example: { ...EXAMPLE_USER, phone: '+84987654321' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('người dùng')
  update(@Param('user_id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.update(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':user_id/disable')
  @RequirePermissions('user.disable')
  @ApiOperation({ summary: 'Khoá hoặc mở khoá người dùng', description: '`{ disabled: true }` khoá và **huỷ mọi phiên** ngay; `{ disabled: false }` mở lại. Không tự khoá mình (422).' })
  @ApiParam(ID)
  @ApiBody({ type: DisableUserDto, examples: { khoa: { value: { disabled: true, reason: 'Nghỉ việc' } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi đổi.', example: { ...EXAMPLE_USER, status: 'DISABLED' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('người dùng')
  disable(@Param('user_id', ParseUUIDPipe) id: string, @Body() dto: DisableUserDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.setDisabled(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':user_id/roles')
  @RequirePermissions('user.assign_role')
  @ApiOperation({ summary: 'Gán vai trò', description: '**Thay thế** toàn bộ vai trò hiện có bằng `role_ids`, không cộng dồn. Có hiệu lực ngay (guard nạp quyền từ DB mỗi request). Quản trị DN không gán được `SYSTEM_ADMIN`.' })
  @ApiParam(ID)
  @ApiBody({ type: AssignRolesDto, examples: { gan: { value: { role_ids: [EXAMPLE_ROLE_REF.role_id] } } } })
  @ApiEnvelopeResponse({ description: 'Sau khi gán.', example: EXAMPLE_USER })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('người dùng')
  assignRoles(@Param('user_id', ParseUUIDPipe) id: string, @Body() dto: AssignRolesDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.assignRoles(id, dto, { actor, ...requestMeta(req) });
  }

  @Put(':user_id/reset-password')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Quản trị đặt lại mật khẩu cho người dùng', description: 'Không có trong đặc tả nhưng cần cho quy trình "quên mật khẩu" khi chưa có kênh email. Bỏ trống `new_password` thì server sinh và trả **một lần**. Huỷ mọi phiên của người đó, mở khoá tạm nếu đang bị khoá, ép đổi mật khẩu ở lần đăng nhập sau.' })
  @ApiParam(ID)
  @ApiBody({ type: ResetPasswordByAdminDto, examples: { tudong: { value: {} } } })
  @ApiEnvelopeResponse({ description: 'Mật khẩu tạm (chỉ khi server sinh).', example: { temporary_password: 'Xk9pQ2mZ7vLw' } })
  @ApiValidationError() @ApiAuthErrors() @ApiNotFoundError('người dùng')
  resetPassword(@Param('user_id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordByAdminDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.resetPassword(id, dto, { actor, ...requestMeta(req) });
  }

  @Delete(':user_id')
  @HttpCode(204)
  @RequirePermissions('user.delete')
  @ApiOperation({ summary: 'Xoá người dùng', description: 'Soft delete: dòng còn để audit trỏ về, `username` được giải phóng để dùng lại. Huỷ mọi phiên. Không tự xoá mình (422).' })
  @ApiParam(ID)
  @ApiNoContentResponse('Đã xoá.')
  @ApiAuthErrors() @ApiNotFoundError('người dùng')
  delete(@Param('user_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.delete(id, { actor, ...requestMeta(req) });
  }
}

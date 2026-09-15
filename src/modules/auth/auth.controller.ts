import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-context';
import {
  ApiAuthErrors,
  ApiEnvelopeError,
  ApiEnvelopeResponse,
  ApiNoContentResponse,
  ApiValidationError,
} from '../../common/swagger/api-envelope';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto, UpdateProfileDto } from './dto/auth.dto';
import {
  EXAMPLE_CHANGE_PASSWORD,
  EXAMPLE_LOGIN_REQUEST,
  EXAMPLE_LOGIN_RESPONSE,
  EXAMPLE_SESSION_USER,
  EXAMPLE_UPDATE_PROFILE,
} from './dto/auth.examples';
import { SessionCookie } from './session-cookie';

/**
 * Nhóm `/auth` (docs/api-contracts.md mục 1). Access token trong body, refresh
 * token CHỈ trong cookie httpOnly `qltb_rt` (path /api/v1/auth).
 * Chưa có: forgot-password / reset-password (cần kênh gửi mã — chốt sau).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập',
    description:
      'Trả `access_token` (JWT ~15 phút) trong body và đặt cookie httpOnly chứa refresh token ' +
      '(7 ngày, xoay sau mỗi lần dùng). Sai tên đăng nhập hay sai mật khẩu đều là cùng một 401 — ' +
      'không nói rõ cái nào sai. Sai 5 lần liên tiếp thì khoá tạm 15 phút, `details.locked_until` ' +
      'cho biết tới khi nào. Tài khoản `DISABLED` hoặc doanh nghiệp `SUSPENDED` cũng 401. ' +
      'Web phải gọi với `credentials: include` để nhận cookie.',
  })
  @ApiBody({ type: LoginDto, examples: { admin: { value: EXAMPLE_LOGIN_REQUEST } } })
  @ApiEnvelopeResponse({ description: 'Đăng nhập thành công. Refresh token nằm ở cookie, không ở body.', example: EXAMPLE_LOGIN_RESPONSE })
  @ApiValidationError()
  @ApiEnvelopeError({
    status: 401,
    code: 'AUTHENTICATION_FAILED',
    message: 'Tên đăng nhập hoặc mật khẩu không đúng',
    description: 'Sai thông tin, tài khoản bị khoá tạm (`details.locked_until`), DISABLED, hoặc doanh nghiệp SUSPENDED.',
  })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.username, dto.password, requestMeta(req));
    this.cookie.set(res, result);
    return SessionCookie.toBody(result);
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cấp access token mới bằng refresh token trong cookie',
    description:
      'Đọc cookie `qltb_rt`, phát cặp token mới và **thu hồi thẻ cũ**. Dùng lại thẻ cũ lần thứ hai ' +
      'là dấu hiệu bị đánh cắp: server huỷ CẢ phiên, người dùng thật cũng phải đăng nhập lại. ' +
      'Web gọi refresh **một promise dùng chung** — ba request cùng 401 mà gọi refresh ba lần là ' +
      'hai lần sau bị coi là dùng lại thẻ.',
  })
  @ApiEnvelopeResponse({ description: 'Cặp token mới. Cookie được đặt lại.', example: EXAMPLE_LOGIN_RESPONSE })
  @ApiEnvelopeError({
    status: 401,
    code: 'AUTHENTICATION_FAILED',
    message: 'Refresh token không hợp lệ',
    description: 'Thiếu cookie, thẻ đã dùng, đã huỷ, hết hạn, hoặc tài khoản không còn hiệu lực. Web về màn đăng nhập, không retry.',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const plain = readCookie(req, this.cookie.name);
    if (!plain) {
      this.cookie.clear(res);
      return this.auth.refresh('', requestMeta(req)); // ném 401 chuẩn
    }
    try {
      const result = await this.auth.refresh(plain, requestMeta(req));
      this.cookie.set(res, result);
      return SessionCookie.toBody(result);
    } catch (error) {
      this.cookie.clear(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Đăng xuất',
    description:
      'Huỷ toàn bộ họ refresh token của phiên trong cookie và xoá cookie. Không cần access token ' +
      '(nó có thể đã hết hạn) — chỉ cần cookie. Không có cookie vẫn 204: đăng xuất là idempotent. ' +
      'Access token đang cầm vẫn dùng được tới khi hết hạn (tối đa 15 phút) — chấp nhận, vì thu hồi ' +
      'JWT ngay lập tức đòi tra DB mỗi request theo session_id (chưa làm).',
  })
  @ApiNoContentResponse('Đã đăng xuất, cookie đã xoá.')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req, this.cookie.name), requestMeta(req));
    this.cookie.clear(res);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quên mật khẩu', description: 'Nhận `username` hoặc `email`. **Luôn 204** dù có tài khoản hay không — không dò được tên đăng nhập. Sinh mã đặt lại hạn 30 phút. Chưa có kênh gửi email/SMS: ở môi trường dev mã ghi ra log server; quản trị cũng đặt lại được trực tiếp qua `PUT /users/{id}/reset-password`.' })
  @ApiBody({ type: ForgotPasswordDto, examples: { quen: { value: { identifier: 'ketoan.dongdanh' } } } })
  @ApiNoContentResponse('Đã ghi nhận (dù có tài khoản hay không).')
  @ApiValidationError()
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto.identifier, requestMeta(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Đặt lại mật khẩu bằng mã', description: 'Mã từ bước quên mật khẩu, dùng một lần, hạn 30 phút. Thành công thì huỷ mọi phiên cũ. Sai / hết hạn → 401.' })
  @ApiBody({ type: ResetPasswordDto, examples: { dat: { value: { token: 'k3Jf9…', new_password: 'MatKhauMoi#2026' } } } })
  @ApiNoContentResponse('Đã đặt lại.')
  @ApiValidationError()
  @ApiEnvelopeError({ status: 401, code: 'AUTHENTICATION_FAILED', message: 'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn', description: 'Mã sai, đã dùng, hoặc quá 30 phút — làm lại bước quên mật khẩu.' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.new_password, requestMeta(req));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Người đang đăng nhập kèm vai trò và quyền',
    description:
      'Nạp lại từ DB, không đọc từ token — đổi vai trò / quyền có hiệu lực ngay. Web gọi lúc ' +
      'khởi động (sau refresh) để dựng lại phiên sau F5, và dùng `permissions` để ẩn/hiện nút.',
  })
  @ApiEnvelopeResponse({ description: 'Người dùng hiện tại.', example: EXAMPLE_SESSION_USER })
  @ApiAuthErrors()
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.me(actor);
  }

  @Put('change-password')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đổi mật khẩu khi đang đăng nhập',
    description:
      'Sai `current_password` → 401 (không tăng đếm khoá). Thành công thì **huỷ mọi phiên khác** ' +
      'của tài khoản — thiết bị khác phải đăng nhập lại — phiên hiện tại giữ nguyên. ' +
      'Tắt cờ `must_change_password`.',
  })
  @ApiBody({ type: ChangePasswordDto, examples: { doi: { value: EXAMPLE_CHANGE_PASSWORD } } })
  @ApiNoContentResponse('Đã đổi mật khẩu.')
  @ApiValidationError()
  @ApiAuthErrors()
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.auth.changePassword(actor, dto.current_password, dto.new_password, requestMeta(req));
  }

  @Put('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật thông tin cá nhân',
    description:
      'Chỉ `full_name`, `email`, `phone`. Không đổi được `username`, vai trò, doanh nghiệp — ' +
      'đó là việc của quản trị qua `/users`. Ghi audit với giá trị trước / sau.',
  })
  @ApiBody({ type: UpdateProfileDto, examples: { hoso: { value: EXAMPLE_UPDATE_PROFILE } } })
  @ApiEnvelopeResponse({ description: 'Hồ sơ sau khi sửa.', example: { ...EXAMPLE_SESSION_USER, ...EXAMPLE_UPDATE_PROFILE } })
  @ApiValidationError()
  @ApiAuthErrors()
  updateProfile(@Body() dto: UpdateProfileDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.auth.updateProfile(actor, dto, requestMeta(req));
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const value = cookies?.[name];
  return typeof value === 'string' && value ? value : undefined;
}

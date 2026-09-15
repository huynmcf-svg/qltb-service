import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthContextService } from '../../modules/auth/auth-context.service';
import type { AccessTokenPayload } from '../auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../decorators';
import { AppException } from '../errors/app.exception';
import type { RequestContext } from '../request-context';

/**
 * Xác thực bằng access token JWT qua `Authorization: Bearer`. Cookie refresh
 * chỉ nhánh /auth mới đọc.
 *
 * Guard đăng ký GLOBAL: mặc định mọi endpoint đều đóng, phải chủ động gắn
 * `@Public()` mới hở.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authContext: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestContext>();
    const token = extractBearerToken(req);
    if (!token) throw AppException.authenticationFailed('Thiếu access token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.accessSecret'),
        issuer: this.config.getOrThrow<string>('auth.issuer'),
      });
    } catch {
      // Không phân biệt "hết hạn" với "chữ ký sai": cả hai đều 401 và web xử
      // lý giống nhau (refresh một lần rồi thôi).
      throw AppException.authenticationFailed('Access token không hợp lệ hoặc đã hết hạn');
    }
    if (!payload.session_id) {
      throw AppException.authenticationFailed('Access token không hợp lệ hoặc đã hết hạn');
    }

    /*
     * Nạp lại người dùng và quyền TỪ DB mỗi request, không tin token. Token
     * sống 15 phút; tin payload thì khoá tài khoản / gỡ quyền chỉ có hiệu lực
     * sau 15 phút. Một truy vấn mỗi request là cái giá chấp nhận được.
     */
    const principal = await this.authContext.loadPrincipal(payload.sub);
    if (!principal) throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');

    req.auth_user = { ...principal, session_id: payload.session_id };
    return true;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

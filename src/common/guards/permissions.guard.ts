import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../../modules/permission/permission.catalog';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators';
import { AppException } from '../errors/app.exception';
import type { RequestContext } from '../request-context';

/**
 * Kiểm quyền theo `@RequirePermissions(...)`. Chạy SAU `AccessTokenGuard` —
 * `req.auth_user` đã có, và `permissions` trong đó vừa nạp từ DB.
 * Không khai quyền = chỉ cần đăng nhập.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<RequestContext>().auth_user;
    if (!user) return true; // endpoint @Public — không có gì để kiểm

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      // Nêu rõ quyền thiếu để web hiện đúng lý do thay vì "không có quyền" chung chung.
      throw AppException.authorizationFailed('Không đủ quyền thực hiện thao tác này', {
        required_permissions: required,
        missing_permissions: missing,
      });
    }
    return true;
  }
}

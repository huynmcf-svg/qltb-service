import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { Permission } from '../permission/permission.catalog';
import { AuthRepository, type UserWithAccess } from './auth.repository';

/**
 * Dựng `AuthenticatedUser` từ DB. Guard gọi mỗi request; auth service gọi lúc
 * login / refresh. Một chỗ duy nhất quyết định "tài khoản này còn dùng được không".
 */
@Injectable()
export class AuthContextService {
  constructor(private readonly repository: AuthRepository) {}

  /** `null` khi không còn hiệu lực: không tồn tại, DISABLED, hoặc doanh nghiệp SUSPENDED. */
  async loadPrincipal(user_id: string): Promise<Omit<AuthenticatedUser, 'session_id'> | null> {
    const found = await this.repository.findUserById(user_id);
    if (!found) return null;
    return this.toPrincipal(found);
  }

  async toPrincipal(found: UserWithAccess): Promise<Omit<AuthenticatedUser, 'session_id'> | null> {
    const { user, enterprise } = found;
    if (user.status !== 'ACTIVE') return null;
    // Doanh nghiệp bị đình chỉ thì mọi người dùng của nó mất đường vào — kể cả
    // người đang có access token còn hạn, vì guard nạp lại chỗ này mỗi request.
    if (enterprise && enterprise.status !== 'ACTIVE') return null;

    return {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      enterprise_id: enterprise?.enterprise_id ?? null,
      enterprise_name: enterprise?.name ?? null,
      roles: found.roles,
      permissions: found.permissions as Permission[],
      scope: enterprise ? await this.repository.enterpriseScope(enterprise.enterprise_id) : null,
      must_change_password: user.must_change_password,
    };
  }
}

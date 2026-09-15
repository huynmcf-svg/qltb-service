import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AppException } from '../../common/errors/app.exception';
import { AppLogger } from '../../common/logger/app-logger.service';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service';
import { AuthContextService } from './auth-context.service';
import { AuthRepository, type UserWithAccess } from './auth.repository';
import { PasswordService } from './password.service';
import { TokenService, hashRefreshToken } from './token.service';

export interface RequestMeta {
  request_id: string;
  ip?: string;
  user_agent?: string;
}

/** Resource `SessionUser` của hợp đồng (docs/api-contracts.md mục 1). */
export interface SessionUser {
  user_id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  enterprise_id: string | null;
  enterprise_name: string | null;
  roles: string[];
  permissions: string[];
  must_change_password: boolean;
}

export interface SessionResult {
  access_token: string;
  expires_in: number;
  /** Chỉ để controller đặt cookie. KHÔNG bao giờ đưa vào response body. */
  refresh_token: string;
  refresh_expires_at: Date;
  user: SessionUser;
}

const invalidCredentials = () => AppException.authenticationFailed('Tên đăng nhập hoặc mật khẩu không đúng');

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly context: AuthContextService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  async login(username: string, password: string, meta: RequestMeta): Promise<SessionResult> {
    const found = await this.repository.findUserByUsername(username);
    if (!found) {
      await this.passwords.burnTime(password);
      await this.auditLoginFailure(username, 'USER_NOT_FOUND', meta);
      throw invalidCredentials();
    }
    const { user } = found;

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await this.auditLoginFailure(username, 'TEMPORARILY_LOCKED', meta, user.enterprise_id);
      throw AppException.authenticationFailed('Tài khoản đang bị khoá tạm do đăng nhập sai nhiều lần', {
        locked_until: user.locked_until.toISOString(),
      });
    }

    const ok = await this.passwords.verify(user.password_hash, password);
    if (!ok) {
      await this.repository.recordLoginFailure(
        user.user_id,
        this.config.getOrThrow<number>('auth.maxFailedLogins'),
        this.config.getOrThrow<number>('auth.lockDurationSeconds'),
      );
      await this.auditLoginFailure(username, 'BAD_PASSWORD', meta, user.enterprise_id);
      throw invalidCredentials();
    }

    // Mật khẩu đúng nhưng tài khoản DISABLED / doanh nghiệp SUSPENDED: cùng
    // 401, message khác — lúc này nói rõ lý do không còn là kênh dò tài khoản.
    const principal = await this.context.toPrincipal(found);
    if (!principal) {
      await this.auditLoginFailure(username, `STATUS_${user.status}`, meta, user.enterprise_id);
      throw AppException.authenticationFailed('Tài khoản hoặc doanh nghiệp đã bị khoá');
    }

    await this.repository.recordLoginSuccess(user.user_id);
    const sessionId = this.tokens.newSessionId();
    const result = await this.issueSession(found, principal, sessionId, meta);

    await this.audit.record({
      module: 'auth',
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      resource_type: 'session',
      resource_id: sessionId,
      enterprise_id: user.enterprise_id,
      actor: { user_id: user.user_id, username: user.username },
      ...meta,
    });
    return result;
  }

  /**
   * Xoay refresh token. Luật theo thứ tự:
   *   1. Không tra ra hash → 401.
   *   2. Tra ra nhưng ĐÃ DÙNG → dùng lại thẻ cũ: huỷ CẢ HỌ, audit, 401. Một
   *      trong hai bên đang cầm token bị đánh cắp và không biết bên nào.
   *   3. Đã huỷ / hết hạn → 401.
   *   4. Còn dùng được → đánh dấu đã dùng (có điều kiện) rồi phát cặp mới cùng họ.
   */
  async refresh(plainRefreshToken: string, meta: RequestMeta): Promise<SessionResult> {
    const session = await this.repository.findSessionByHash(hashRefreshToken(plainRefreshToken));
    if (!session) throw AppException.authenticationFailed('Refresh token không hợp lệ');

    if (session.used_at) {
      const revoked = await this.repository.revokeSessionFamily(session.session_id, 'REUSE_DETECTED');
      this.logger.warn('refresh token reuse detected', {
        request_id: meta.request_id,
        user_id: session.user_id,
        session_id: session.session_id,
        revoked_tokens: revoked,
      });
      await this.audit.record({
        module: 'auth',
        action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE_DETECTED,
        resource_type: 'session',
        resource_id: session.session_id,
        actor: null,
        new_values: { user_id: session.user_id, revoked_tokens: revoked },
        ...meta,
      });
      throw AppException.authenticationFailed('Refresh token đã được dùng trước đó. Phiên đã bị huỷ vì lý do an toàn.');
    }
    if (session.revoked_at) throw AppException.authenticationFailed('Phiên đã bị huỷ');
    if (session.expires_at.getTime() <= Date.now()) throw AppException.authenticationFailed('Refresh token đã hết hạn');

    const found = await this.repository.findUserById(session.user_id);
    const principal = found ? await this.context.toPrincipal(found) : null;
    if (!found || !principal) {
      await this.repository.revokeSessionFamily(session.session_id, 'USER_DISABLED');
      throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');
    }

    const next = this.tokens.issueRefreshToken();
    const created = await this.repository.createSessionToken({
      session_id: session.session_id,
      user_id: session.user_id,
      refresh_token_hash: next.hash,
      expires_at: next.expires_at,
      ip: meta.ip,
      user_agent: meta.user_agent,
    });
    const marked = await this.repository.markUsedIfUnused(session.session_token_id, created.session_token_id);
    if (!marked) {
      await this.repository.revokeSessionFamily(session.session_id, 'REUSE_DETECTED');
      throw AppException.authenticationFailed('Refresh token đã được dùng trước đó');
    }

    const { token, expires_in } = await this.tokens.signAccessToken({
      user_id: found.user.user_id,
      username: found.user.username,
      session_id: session.session_id,
    });
    return {
      access_token: token,
      expires_in,
      refresh_token: next.plain,
      refresh_expires_at: next.expires_at,
      user: toSessionUser(found, principal),
    };
  }

  /** Đăng xuất: huỷ họ token của cookie hiện tại. Không có cookie thì cũng 204. */
  async logout(plainRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!plainRefreshToken) return;
    const session = await this.repository.findSessionByHash(hashRefreshToken(plainRefreshToken));
    if (!session) return;
    await this.repository.revokeSessionFamily(session.session_id, 'LOGOUT');
    const found = await this.repository.findUserById(session.user_id);
    await this.audit.record({
      module: 'auth',
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      resource_type: 'session',
      resource_id: session.session_id,
      enterprise_id: found?.user.enterprise_id,
      actor: found ? { user_id: found.user.user_id, username: found.user.username } : null,
      ...meta,
    });
  }

  /**
   * Quên mật khẩu: LUÔN trả về như nhau dù có tài khoản hay không (không dò
   * được username). Chưa có kênh email/SMS: token ghi ra log của server (chỉ
   * ngoài production) để quản trị chuyển cho người dùng; song song có
   * `PUT /users/{id}/reset-password` cho quản trị đặt lại trực tiếp.
   */
  async forgotPassword(identifier: string, meta: RequestMeta): Promise<void> {
    const user = await this.repository.findUserByIdentifier(identifier);
    if (!user || user.status !== 'ACTIVE') {
      await this.passwords.burnTime(identifier);
      return;
    }
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 30 * 60_000);
    await this.repository.setResetToken(user.user_id, sha256(token), expires);
    if (this.config.getOrThrow<string>('nodeEnv') !== 'production') {
      // Log ở dev để lấy được token mà không cần mail. Production: nối kênh gửi ở đây.
      this.logger.warn('password reset token issued (dev only)', { request_id: meta.request_id, user_id: user.user_id, reset_token: token, expires_at: expires.toISOString() });
    }
    await this.audit.record({ module: 'auth', action: 'AUTH_FORGOT_PASSWORD', resource_type: 'user', resource_id: user.user_id, enterprise_id: user.enterprise_id, actor: null, new_values: { expires_at: expires.toISOString() }, ...meta });
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const user = await this.repository.findByResetTokenHash(sha256(token));
    if (!user || !user.password_reset_expires_at || user.password_reset_expires_at < new Date()) {
      throw AppException.authenticationFailed('Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }
    await this.repository.updatePassword(user.user_id, await this.passwords.hash(newPassword));
    await this.repository.clearResetToken(user.user_id);
    const revoked = await this.repository.revokeAllSessions(user.user_id, 'PASSWORD_CHANGED');
    await this.audit.record({ module: 'auth', action: 'AUTH_RESET_PASSWORD', resource_type: 'user', resource_id: user.user_id, enterprise_id: user.enterprise_id, actor: { user_id: user.user_id, username: user.username }, new_values: { revoked_sessions: revoked }, ...meta });
  }

  async me(actor: AuthenticatedUser): Promise<SessionUser> {
    const found = await this.repository.findUserById(actor.user_id);
    if (!found) throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');
    return toSessionUser(found, actor);
  }

  /** Đổi mật khẩu: sai mật khẩu cũ → 401. Xong thì huỷ MỌI phiên khác. */
  async changePassword(actor: AuthenticatedUser, current: string, next: string, meta: RequestMeta): Promise<void> {
    const found = await this.repository.findUserById(actor.user_id);
    if (!found) throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');
    if (!(await this.passwords.verify(found.user.password_hash, current))) {
      throw AppException.authenticationFailed('Mật khẩu hiện tại không đúng');
    }
    if (current === next) {
      throw AppException.invalidPayload('Mật khẩu mới phải khác mật khẩu hiện tại', {
        violations: ['new_password phải khác current_password'],
      });
    }
    await this.repository.updatePassword(actor.user_id, await this.passwords.hash(next));
    const revoked = await this.repository.revokeAllSessions(actor.user_id, 'PASSWORD_CHANGED', actor.session_id);
    await this.audit.record({
      module: 'auth',
      action: AUDIT_ACTIONS.AUTH_CHANGE_PASSWORD,
      resource_type: 'user',
      resource_id: actor.user_id,
      enterprise_id: actor.enterprise_id,
      actor: { user_id: actor.user_id, username: actor.username },
      new_values: { revoked_other_sessions: revoked },
      ...meta,
    });
  }

  async updateProfile(
    actor: AuthenticatedUser,
    patch: { full_name?: string; email?: string | null; phone?: string | null },
    meta: RequestMeta,
  ): Promise<SessionUser> {
    const before = await this.repository.findUserById(actor.user_id);
    if (!before) throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');
    await this.repository.updateProfile(actor.user_id, patch);
    const after = await this.repository.findUserById(actor.user_id);
    if (!after) throw AppException.authenticationFailed('Tài khoản không còn hiệu lực');
    await this.audit.record({
      module: 'auth',
      action: AUDIT_ACTIONS.AUTH_UPDATE_PROFILE,
      resource_type: 'user',
      resource_id: actor.user_id,
      enterprise_id: actor.enterprise_id,
      actor: { user_id: actor.user_id, username: actor.username },
      old_values: pick(before.user, Object.keys(patch)),
      new_values: pick(after.user, Object.keys(patch)),
      ...meta,
    });
    return toSessionUser(after, actor);
  }

  private async issueSession(
    found: UserWithAccess,
    principal: Omit<AuthenticatedUser, 'session_id'>,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<SessionResult> {
    const refresh = this.tokens.issueRefreshToken();
    await this.repository.createSessionToken({
      session_id: sessionId,
      user_id: found.user.user_id,
      refresh_token_hash: refresh.hash,
      expires_at: refresh.expires_at,
      ip: meta.ip,
      user_agent: meta.user_agent,
    });
    const { token, expires_in } = await this.tokens.signAccessToken({
      user_id: found.user.user_id,
      username: found.user.username,
      session_id: sessionId,
    });
    return {
      access_token: token,
      expires_in,
      refresh_token: refresh.plain,
      refresh_expires_at: refresh.expires_at,
      user: toSessionUser(found, principal),
    };
  }

  private auditLoginFailure(username: string, reason: string, meta: RequestMeta, enterprise_id?: string | null) {
    return this.audit.record({
      module: 'auth',
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      resource_type: 'user',
      resource_id: username,
      enterprise_id,
      actor: null,
      new_values: { reason },
      ...meta,
    });
  }
}

function toSessionUser(found: UserWithAccess, principal: Pick<AuthenticatedUser, 'roles' | 'permissions' | 'enterprise_id' | 'enterprise_name'>): SessionUser {
  return {
    user_id: found.user.user_id,
    username: found.user.username,
    full_name: found.user.full_name,
    email: found.user.email,
    phone: found.user.phone,
    enterprise_id: principal.enterprise_id,
    enterprise_name: principal.enterprise_name,
    roles: principal.roles,
    permissions: principal.permissions,
    must_change_password: found.user.must_change_password,
  };
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { SessionResult } from './auth.service';

/**
 * Cookie refresh token — dùng chung cho login và refresh, để hai nơi không
 * lệch nhau về httpOnly / path / secure. `path` giới hạn ở /auth để cookie
 * không đính kèm vào mọi request nghiệp vụ.
 */
@Injectable()
export class SessionCookie {
  constructor(private readonly config: ConfigService) {}

  get name(): string {
    return this.config.getOrThrow<string>('auth.cookieName');
  }

  options(expiresAt?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('auth.cookieSecure'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>('auth.cookieSameSite'),
      path: this.config.getOrThrow<string>('auth.cookiePath'),
      ...(expiresAt ? { expires: expiresAt } : {}),
    };
  }

  set(res: Response, result: SessionResult): void {
    res.cookie(this.name, result.refresh_token, this.options(result.refresh_expires_at));
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options());
  }

  /** Body response KHÔNG chứa refresh token — nó chỉ đi trong cookie httpOnly. */
  static toBody(result: SessionResult) {
    return { access_token: result.access_token, expires_in: result.expires_in, user: result.user };
  }
}

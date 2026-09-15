import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload } from '../../common/auth/authenticated-user';

export interface IssuedRefreshToken {
  /** Chỉ tồn tại trong RAM và trong cookie gửi về. Không lưu, không log. */
  plain: string;
  hash: string;
  expires_at: Date;
}

/**
 * Access token: JWT ~15 phút. Refresh token: secret NGẪU NHIÊN, không phải JWT
 * — refresh phải thu hồi được ngay, mà JWT tự nó không thu hồi được; đã tra DB
 * thì chữ ký chỉ là chi phí thừa. 32 byte ngẫu nhiên lưu dạng hash là đủ.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signAccessToken(input: { user_id: string; username: string; session_id: string }) {
    const expiresIn = this.config.getOrThrow<number>('auth.accessTtlSeconds');
    const payload: AccessTokenPayload = {
      sub: input.user_id,
      username: input.username,
      session_id: input.session_id,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('auth.accessSecret'),
      issuer: this.config.getOrThrow<string>('auth.issuer'),
      expiresIn,
    });
    return { token, expires_in: expiresIn };
  }

  issueRefreshToken(): IssuedRefreshToken {
    const plain = randomBytes(32).toString('base64url');
    return {
      plain,
      hash: hashRefreshToken(plain),
      expires_at: new Date(Date.now() + this.config.getOrThrow<number>('auth.refreshTtlSeconds') * 1000),
    };
  }

  newSessionId(): string {
    return randomUUID();
  }
}

/**
 * sha256, không phải argon2: refresh token đã là 32 byte ngẫu nhiên, không có
 * gì để brute-force, và refresh chạy ở đường nóng mỗi 15 phút.
 */
export function hashRefreshToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

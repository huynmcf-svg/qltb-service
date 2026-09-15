import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth/authenticated-user';

/**
 * Những gì service gắn thêm vào request. Khai một chỗ để không ai phải
 * `(req as any)` rải rác.
 */
export interface RequestContext extends Request {
  request_id: string;
  /** Có sau khi qua `AccessTokenGuard`. Endpoint @Public thì không có. */
  auth_user?: AuthenticatedUser;
}

/** `request_id` đi vào cả envelope response lẫn mọi dòng log của request đó. */
export function ensureRequestId(req: Request): string {
  const ctx = req as RequestContext;
  if (!ctx.request_id) {
    // Nhận request_id do web / proxy truyền xuống nếu có — nhờ vậy một sự cố
    // truy được xuyên qua nhiều tầng bằng một mã duy nhất.
    const incoming = req.headers['x-request-id'];
    ctx.request_id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
  }
  return ctx.request_id;
}

export function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

export function getUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
}

/** Bộ ba request_id / ip / user-agent cho audit — dùng ở mọi controller. */
export function requestMeta(req: Request): { request_id: string; ip?: string; user_agent?: string } {
  return { request_id: ensureRequestId(req), ip: getClientIp(req), user_agent: getUserAgent(req) };
}

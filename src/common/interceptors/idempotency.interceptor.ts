import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { Observable, from, of, switchMap } from 'rxjs';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { idempotency_keys } from '../../db/schema';
import { SIDE_EFFECT_KEY } from '../decorators';
import { Envelope, okEnvelope } from '../dto/envelope.dto';
import { AppException } from '../errors/app.exception';
import { ensureRequestId, type RequestContext } from '../request-context';

/**
 * `Idempotency-Key` cho mọi POST có side effect (`@SideEffect()`).
 *
 * | Tình huống          | Kết quả                           |
 * |---------------------|-----------------------------------|
 * | Cùng key, cùng body | Trả lại kết quả cũ, không chạy lại |
 * | Cùng key, khác body | 409 IDEMPOTENCY_KEY_CONFLICT       |
 * | Không có key        | 400 INVALID_PAYLOAD                |
 *
 * Chống race: KHÔNG `SELECT` rồi `INSERT` — unique (actor, key) + `ON CONFLICT
 * DO NOTHING`, request nào không chèn được thì đọc lại bản ghi đã có.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isSideEffect = this.reflector.getAllAndOverride<boolean>(SIDE_EFFECT_KEY, [context.getHandler(), context.getClass()]);
    if (!isSideEffect) return next.handle();

    const req = context.switchToHttp().getRequest<RequestContext>();
    const requestId = ensureRequestId(req);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.trim() === '') {
      throw AppException.invalidPayload('Thiếu header Idempotency-Key', { header: 'Idempotency-Key' });
    }
    const actorId = req.auth_user?.user_id;
    if (!actorId) throw AppException.authenticationFailed('Thiếu access token');

    const endpoint = `${req.method} ${req.route?.path ?? req.originalUrl}`;
    const requestHash = hashBody(req.body);

    return from(this.findExisting(actorId, key)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw AppException.conflict('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key này đã dùng cho một request có nội dung khác');
          }
          context.switchToHttp().getResponse().status(existing.response_status);
          // Giữ `request_id` của lần chạy gốc — lần ngược được về log của lần thực sự ghi.
          return of(existing.response_body as Envelope<unknown>);
        }
        return next.handle().pipe(
          switchMap((data: unknown) =>
            from(this.store({ actorId, key, endpoint, requestHash, status: resolveStatus(this.reflector, context), body: okEnvelope(requestId, data ?? null) })),
          ),
        );
      }),
    );
  }

  private async findExisting(actorId: string, key: string) {
    const rows = await this.db
      .select()
      .from(idempotency_keys)
      .where(and(eq(idempotency_keys.actor_user_id, actorId), eq(idempotency_keys.idempotency_key, key)))
      .limit(1);
    return rows[0];
  }

  private async store(input: { actorId: string; key: string; endpoint: string; requestHash: string; status: number; body: Envelope<unknown> }) {
    const inserted = await this.db
      .insert(idempotency_keys)
      .values({
        actor_user_id: input.actorId,
        idempotency_key: input.key,
        endpoint: input.endpoint,
        request_hash: input.requestHash,
        response_status: input.status,
        response_body: input.body,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) return input.body;
    const existing = await this.findExisting(input.actorId, input.key);
    if (existing && existing.request_hash !== input.requestHash) {
      throw AppException.conflict('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key này đã dùng cho một request có nội dung khác');
    }
    return (existing?.response_body as Envelope<unknown>) ?? input.body;
  }
}

/** Khoá metadata Nest gắn khi thấy `@HttpCode()` — không export khỏi @nestjs/common. */
const HTTP_CODE_METADATA = '__httpCode__';

function resolveStatus(reflector: Reflector, context: ExecutionContext): number {
  const explicit = reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
  if (explicit) return explicit;
  return context.switchToHttp().getRequest<{ method: string }>().method === 'POST' ? 201 : 200;
}

/** Hash body đã chuẩn hoá thứ tự khoá — khác thứ tự field không phải "khác body". */
export function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? null)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { NO_ENVELOPE_KEY } from '../decorators';
import { Envelope, okEnvelope } from '../dto/envelope.dto';
import { ensureRequestId } from '../request-context';

/**
 * Bọc mọi response thành `{ request_id, data, error }`.
 *
 * Controller trả về dữ liệu trần; envelope dựng ở đây để không ai quên. Đường
 * lỗi do `AllExceptionsFilter` lo — hai chỗ phải cho ra cùng một hình dạng.
 *
 * Ngoại lệ duy nhất: endpoint gắn `@NoEnvelope()` (chỉ có `/health`).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Envelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T> | T> {
    const noEnvelope = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noEnvelope) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const requestId = ensureRequestId(req);

    return next.handle().pipe(
      map((data) => {
        // Đã đúng hình dạng envelope (ví dụ phát lại kết quả cũ) thì giữ nguyên.
        if (isEnvelope(data)) return data as Envelope<T>;
        // `data` là `undefined` với endpoint 204 — envelope vẫn phải có `data`,
        // đặt `null` cho web không phải phân biệt hai kiểu "rỗng".
        return okEnvelope<T>(requestId, (data ?? null) as T);
      }),
    );
  }
}

function isEnvelope(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'request_id' in value &&
    'data' in value &&
    'error' in value
  );
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorEnvelope } from '../dto/envelope.dto';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';
import { AppLogger } from '../logger/app-logger.service';
import { ensureRequestId } from '../request-context';

/**
 * Map mọi exception sang envelope lỗi chuẩn.
 *
 * Điểm dễ làm nửa vời: đường thành công có envelope, đường lỗi 500 thì lọt ra
 * ngoài dưới dạng response mặc định của Nest. Web đọc `error.code` để rẽ nhánh
 * nên response lỗi không có envelope là web crash.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = ensureRequestId(req);

    const { status, code, message, details } = mapException(exception);

    if (status >= 500) {
      this.logger.error('request failed', {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        error_code: code,
        // Stack ở log, không bao giờ ở response — nó lộ đường dẫn và cấu trúc nội bộ.
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn('request rejected', {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        status,
        error_code: code,
      });
    }

    res.status(status).json(errorEnvelope(requestId, code, message, details));
  }
}

interface MappedError {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export function mapException(exception: unknown): MappedError {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();

    // ValidationPipe ném BadRequestException với `message` là mảng chuỗi lỗi.
    // Gom vào `details.violations` để web hiện được từng field sai, còn `code`
    // giữ nguyên INVALID_PAYLOAD cho logic máy.
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      const violations = Array.isArray(record.message) ? (record.message as string[]) : undefined;
      return {
        status,
        code: typeof record.code === 'string' ? record.code : defaultCodeForStatus(status),
        message: violations
          ? 'Payload không hợp lệ'
          : typeof record.message === 'string'
            ? record.message
            : exception.message,
        details: violations ? { violations } : {},
      };
    }

    return {
      status,
      code: defaultCodeForStatus(status),
      message: typeof body === 'string' ? body : exception.message,
      details: {},
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    // Không đưa `exception.message` ra ngoài: lỗi driver DB hay lộ tên bảng,
    // tên cột, đôi khi cả chuỗi kết nối.
    message: 'Lỗi hệ thống',
    details: {},
  };
}

/** Map HTTP status sang mã lỗi khi exception không tự khai mã. */
function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ErrorCode.INVALID_PAYLOAD;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.AUTHENTICATION_FAILED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.AUTHORIZATION_FAILED;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

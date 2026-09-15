import { HttpException } from '@nestjs/common';
import { ErrorCode } from './error-code';

/**
 * Exception mang sẵn mã lỗi của hợp đồng.
 *
 * Mọi lỗi nghiệp vụ ném ra bằng lớp này, đừng ném `BadRequestException` trần —
 * `AllExceptionsFilter` sẽ phải đoán mã, và đoán sai thì web rẽ nhánh sai.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }

  static invalidPayload(message = 'Payload không hợp lệ', details: Record<string, unknown> = {}) {
    return new AppException(ErrorCode.INVALID_PAYLOAD, 400, message, details);
  }

  static authenticationFailed(message = 'Xác thực thất bại', details: Record<string, unknown> = {}) {
    return new AppException(ErrorCode.AUTHENTICATION_FAILED, 401, message, details);
  }

  static authorizationFailed(message = 'Không đủ quyền', details: Record<string, unknown> = {}) {
    return new AppException(ErrorCode.AUTHORIZATION_FAILED, 403, message, details);
  }

  static notFound(resource: string, id?: string) {
    return new AppException(
      ErrorCode.RESOURCE_NOT_FOUND,
      404,
      `Không tìm thấy ${resource}`,
      id ? { resource, id } : { resource },
    );
  }

  /** 409 — vi phạm ràng buộc trạng thái / unique. */
  static conflict(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    return new AppException(code, 409, message, details);
  }

  /** 422 — JSON đúng cú pháp nhưng vi phạm nghiệp vụ. Khác 409 (xung đột trạng thái). */
  static unprocessable(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    return new AppException(code, 422, message, details);
  }
}

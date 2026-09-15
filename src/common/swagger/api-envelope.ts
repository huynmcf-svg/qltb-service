import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/**
 * Decorator sinh ví dụ response **đã bọc envelope**.
 *
 * Vì sao cần: envelope `{ request_id, data, error }` do `ResponseInterceptor`
 * thêm vào lúc chạy, còn kiểu trả về của controller là dữ liệu trần. Swagger
 * suy schema từ kiểu trả về, nên nếu không khai gì thì tài liệu sẽ nói response
 * là `{ device_id, ... }` trong khi thứ web thực sự nhận được là
 * `{ request_id, data: { device_id, ... }, error: null }`.
 *
 * `example` là giá trị của **`data`**; phần bọc do hàm này thêm.
 */
export function ApiEnvelopeResponse(options: {
  status?: number;
  description: string;
  /** Giá trị của `data`. Đừng tự bọc envelope ở đây. */
  example: unknown;
}) {
  return applyDecorators(
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      content: {
        'application/json': {
          example: {
            request_id: EXAMPLE_REQUEST_ID,
            data: options.example,
            error: null,
          },
        },
      },
    }),
  );
}

/** Response 204: không có body, nên cũng không có envelope. */
export function ApiNoContentResponse(description: string) {
  return applyDecorators(ApiResponse({ status: 204, description }));
}

/**
 * Ví dụ response LỖI, cũng bọc envelope.
 *
 * Máy đọc `error.code`, **không** parse `error.message`. Đó là lý do mọi ví dụ
 * lỗi ở đây đều nêu `code` cụ thể thay vì một câu mô tả chung chung.
 */
export function ApiEnvelopeError(options: {
  status: number;
  code: string;
  message: string;
  description: string;
  details?: Record<string, unknown>;
}) {
  return applyDecorators(
    ApiResponse({
      status: options.status,
      description: options.description,
      content: {
        'application/json': {
          example: {
            request_id: EXAMPLE_REQUEST_ID,
            data: null,
            error: {
              code: options.code,
              message: options.message,
              details: options.details ?? {},
            },
          },
        },
      },
    }),
  );
}

/** Lỗi validate — mọi endpoint nhận body / query đều trả được. */
export function ApiValidationError() {
  return ApiEnvelopeError({
    status: 400,
    code: 'INVALID_PAYLOAD',
    message: 'Payload không hợp lệ',
    description:
      'Sai kiểu, thiếu field bắt buộc, hoặc có field lạ (server KHÔNG im lặng bỏ qua). ' +
      '`details.violations` liệt kê từng lỗi để web hiện đúng field.',
    details: { violations: ['code should not be empty'] },
  });
}

/** `404` cho endpoint thao tác trên một bản ghi cụ thể. */
export function ApiNotFoundError(resource: string) {
  return ApiEnvelopeError({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    message: `Không tìm thấy ${resource}`,
    description: `Không có bản ghi đó, **hoặc** nó nằm ngoài phạm vi người gọi được thấy.`,
    details: { resource },
  });
}

const EXAMPLE_REQUEST_ID = 'a3f1c9e4-7b62-4d18-9f03-2c5e81aa4d77';

/** Bộ lỗi mà **mọi** endpoint cần token đều trả được. Khai một lần, không ai quên. */
export function ApiAuthErrors() {
  return applyDecorators(
    ApiEnvelopeError({
      status: 401,
      code: 'AUTHENTICATION_FAILED',
      message: 'Access token không hợp lệ hoặc đã hết hạn',
      description:
        'Thiếu token, token sai chữ ký, token hết hạn, hoặc tài khoản không còn hiệu lực. ' +
        'Web gọi `POST /auth/refresh-token` MỘT lần rồi thử lại; vẫn 401 thì về màn đăng nhập.',
    }),
    ApiEnvelopeError({
      status: 403,
      code: 'AUTHORIZATION_FAILED',
      message: 'Không đủ quyền thực hiện thao tác này',
      description:
        'Token hợp lệ nhưng vai trò thiếu quyền. `details.missing_permissions` nêu rõ quyền còn thiếu.',
      details: { required_permissions: ['device.create'], missing_permissions: ['device.create'] },
    }),
  );
}

/** Lỗi của endpoint bắt buộc `Idempotency-Key` (`@SideEffect`). */
export function ApiIdempotencyErrors() {
  return applyDecorators(
    ApiEnvelopeError({
      status: 400,
      code: 'INVALID_PAYLOAD',
      message: 'Thiếu header Idempotency-Key',
      description: 'Mọi POST có side effect đều bắt buộc header này. Một lần bấm sinh một key.',
      details: { header: 'Idempotency-Key' },
    }),
    ApiEnvelopeError({
      status: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      message: 'Idempotency-Key đã dùng với body khác',
      description: 'Cùng key + **cùng** body thì trả lại kết quả cũ. Cùng key + **khác** body mới là 409.',
    }),
  );
}

/** 409 xung đột trạng thái — máy trạng thái từ chối. */
export function ApiStateConflict(code: string, message: string, description: string, details: Record<string, unknown> = {}) {
  return ApiEnvelopeError({ status: 409, code, message, description, details });
}

/** 422 vi phạm nghiệp vụ. */
export function ApiUnprocessable(code: string, message: string, description: string, details: Record<string, unknown> = {}) {
  return ApiEnvelopeError({ status: 422, code, message, description, details });
}

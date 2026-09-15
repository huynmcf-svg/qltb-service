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

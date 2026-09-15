import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Envelope dùng cho MỌI response, kể cả lỗi. Web đọc `error` trước, `data` sau.
 * Nguồn: docs/api-contracts.md mục "Envelope".
 */
export class ErrorBody {
  @ApiProperty({ example: 'RESOURCE_NOT_FOUND' })
  code!: string;

  /** Để NGƯỜI đọc khi chẩn đoán. Logic máy bám vào `code`, không parse chuỗi này. */
  @ApiProperty({ example: 'Không tìm thấy thiết bị' })
  message!: string;

  @ApiProperty({ type: Object, default: {} })
  details!: Record<string, unknown>;
}

export class Envelope<T> {
  @ApiProperty({ example: 'a3f1c9e4-...' })
  request_id!: string;

  @ApiPropertyOptional({ nullable: true })
  data!: T | null;

  @ApiPropertyOptional({ type: ErrorBody, nullable: true })
  error!: ErrorBody | null;
}

export function okEnvelope<T>(request_id: string, data: T): Envelope<T> {
  return { request_id, data, error: null };
}

export function errorEnvelope(
  request_id: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): Envelope<never> {
  return { request_id, data: null, error: { code, message, details } };
}

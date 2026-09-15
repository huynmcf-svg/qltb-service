import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Phân trang bằng CURSOR, không phải offset.
 *
 * Lịch sử thiết bị là chuỗi ghi liên tục; offset pagination sẽ nhảy cóc hoặc
 * lặp bản ghi khi có bản ghi mới chen vào giữa hai lần gọi
 * (docs/api-contracts.md mục "Phân trang").
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Opaque. Web không được parse hay tự sinh. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface CursorPage<T> {
  items: T[];
  /** `null` khi đã hết dữ liệu. */
  next_cursor: string | null;
}

/**
 * Cursor mã hoá `(khoá sắp xếp, id)` chứ không chỉ khoá sắp xếp: hai bản ghi
 * trùng khoá là chuyện thường (hai thiết bị cùng tên, hai dòng lịch sử cùng
 * mốc thời gian) và cursor chỉ mang khoá sẽ bỏ sót hoặc lặp đúng những bản
 * ghi đó.
 *
 * `ts` là khoá sắp xếp của truy vấn, KHÔNG nhất thiết là mốc thời gian.
 */
export interface CursorPayload {
  ts: string;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).ts === 'string' &&
      (parsed as CursorPayload).ts.length > 0 &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

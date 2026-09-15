/**
 * Nhận diện lỗi từ driver `pg` theo SQLSTATE, để repository map sang mã lỗi
 * của hợp đồng thay vì để lọt ra 500.
 *
 * Cách làm đúng cho unique: cứ INSERT rồi bắt 23505 — không SELECT trước, hai
 * request song song sẽ lọt cả hai qua bước SELECT.
 */
interface PgError extends Error {
  code?: string;
  constraint?: string;
}

function asPgError(error: unknown): PgError | null {
  if (typeof error !== 'object' || error === null) return null;
  // drizzle bọc lỗi driver vào `cause`.
  const cause = (error as { cause?: unknown }).cause;
  const candidate = (cause ?? error) as PgError;
  return typeof candidate.code === 'string' ? candidate : null;
}

/** 23505 — unique_violation. Trả tên constraint để biết cột nào trùng. */
export function uniqueViolation(error: unknown): string | null {
  const pg = asPgError(error);
  return pg?.code === '23505' ? (pg.constraint ?? '') : null;
}

/** 23503 — foreign_key_violation. */
export function foreignKeyViolation(error: unknown): string | null {
  const pg = asPgError(error);
  return pg?.code === '23503' ? (pg.constraint ?? '') : null;
}

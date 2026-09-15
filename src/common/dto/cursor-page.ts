import { and, asc, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor, type CursorPage, type CursorPaginationDto } from './pagination.dto';

/**
 * Bộ tiện ích cursor cho danh sách sắp theo `(ts DESC, id DESC)`.
 * Repository: lấy `limit + 1` dòng, rồi `toPage()` cắt và sinh `next_cursor`.
 */
export function cursorWhere(tsColumn: PgColumn, idColumn: PgColumn, query: CursorPaginationDto): SQL | undefined {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (!cursor) return undefined;
  const ts = new Date(cursor.ts);
  return or(lt(tsColumn, ts), and(eq(tsColumn, ts), lt(idColumn, cursor.id)));
}

export function cursorOrder(tsColumn: PgColumn, idColumn: PgColumn): SQL[] {
  return [desc(tsColumn), desc(idColumn)];
}

export function pageLimit(query: CursorPaginationDto): number {
  return query.limit ?? DEFAULT_PAGE_LIMIT;
}

export function toPage<Row, View>(
  rows: Row[],
  limit: number,
  key: (row: Row) => { ts: Date; id: string },
  map: (row: Row) => View,
): CursorPage<View> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    next_cursor: hasMore && last ? encodeCursor({ ts: key(last).ts.toISOString(), id: key(last).id }) : null,
  };
}

/** Escape ký tự đặc biệt của LIKE, để người dùng gõ `%` không thành wildcard. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Bỏ `undefined` khỏi mảng điều kiện để đưa vào `and(...)`. */
export function defined(conditions: (SQL | undefined)[]): SQL[] {
  return conditions.filter((c): c is SQL => c !== undefined);
}

/** Biến thể sắp TĂNG dần (bảo hành sắp hết hạn trước). `parse` cho cột `date` (chuỗi). */
export function cursorWhereAsc(
  tsColumn: PgColumn,
  idColumn: PgColumn,
  query: CursorPaginationDto,
  parse: (ts: string) => unknown = (ts) => new Date(ts),
): SQL | undefined {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (!cursor) return undefined;
  const ts = parse(cursor.ts);
  return or(gt(tsColumn, ts), and(eq(tsColumn, ts), gt(idColumn, cursor.id)));
}

export function cursorOrderAsc(tsColumn: PgColumn, idColumn: PgColumn): SQL[] {
  return [asc(tsColumn), asc(idColumn)];
}

export function toPageAsc<Row, View>(
  rows: Row[],
  limit: number,
  key: (row: Row) => { ts: string; id: string },
  map: (row: Row) => View,
): CursorPage<View> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { items: page.map(map), next_cursor: hasMore && last ? encodeCursor(key(last)) : null };
}

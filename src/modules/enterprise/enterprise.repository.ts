import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrder, cursorWhere, defined, likePattern, pageLimit, toPage } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { devices, enterprises, users } from '../../db/schema';
import type { EnterpriseView, ListEnterprisesDto } from './dto/enterprise.dto';

type Row = typeof enterprises.$inferSelect;
type Insert = typeof enterprises.$inferInsert;

@Injectable()
export class EnterpriseRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private baseSelect() {
    const parent = alias(enterprises, 'parent');
    const userCount = this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.enterprise_id, enterprises.enterprise_id), isNull(users.deleted_at)));
    const deviceCount = this.db.select({ n: count() }).from(devices).where(eq(devices.enterprise_id, enterprises.enterprise_id));
    const branches = alias(enterprises, 'branches');
    const branchCount = this.db.select({ n: count() }).from(branches).where(eq(branches.parent_id, enterprises.enterprise_id));
    return this.db
      .select({
        row: enterprises,
        parent_name: parent.name,
        user_count: sql<number>`(${userCount})`.mapWith(Number),
        device_count: sql<number>`(${deviceCount})`.mapWith(Number),
        branch_count: sql<number>`(${branchCount})`.mapWith(Number),
      })
      .from(enterprises)
      .leftJoin(parent, eq(enterprises.parent_id, parent.enterprise_id));
  }

  async list(query: ListEnterprisesDto, scope: string[] | null): Promise<CursorPage<EnterpriseView>> {
    const limit = pageLimit(query);
    const conditions = defined([
      scopeCondition(enterprises.enterprise_id, scope),
      query.status ? eq(enterprises.status, query.status) : undefined,
      query.parent_id === 'null' ? isNull(enterprises.parent_id) : query.parent_id ? eq(enterprises.parent_id, query.parent_id) : undefined,
      query.q ? or(ilike(enterprises.code, likePattern(query.q)), ilike(enterprises.name, likePattern(query.q)), ilike(enterprises.tax_code, likePattern(query.q))) : undefined,
      cursorWhere(enterprises.created_at, enterprises.enterprise_id, query),
    ]);
    const rows = await this.baseSelect()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(enterprises.created_at, enterprises.enterprise_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.row.created_at, id: r.row.enterprise_id }), (r) => toView(r));
  }

  async findById(enterprise_id: string): Promise<EnterpriseView | null> {
    const [row] = await this.baseSelect().where(eq(enterprises.enterprise_id, enterprise_id)).limit(1);
    return row ? toView(row) : null;
  }

  async findRaw(enterprise_id: string): Promise<Row | null> {
    const [row] = await this.db.select().from(enterprises).where(eq(enterprises.enterprise_id, enterprise_id)).limit(1);
    return row ?? null;
  }

  async branches(enterprise_id: string): Promise<EnterpriseView[]> {
    const rows = await this.baseSelect().where(eq(enterprises.parent_id, enterprise_id)).orderBy(enterprises.name);
    return rows.map(toView);
  }

  async create(input: Insert): Promise<Row> {
    const [row] = await this.db.insert(enterprises).values(input).returning();
    if (!row) throw new Error('insert enterprises không trả về dòng nào');
    return row;
  }

  async update(enterprise_id: string, patch: Partial<Insert>): Promise<Row | null> {
    const [row] = await this.db.update(enterprises).set(patch).where(eq(enterprises.enterprise_id, enterprise_id)).returning();
    return row ?? null;
  }

  /** Đổi trạng thái DN và MỌI chi nhánh con trong một câu. */
  async setStatusWithBranches(enterprise_id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<number> {
    const rows = await this.db
      .update(enterprises)
      .set({ status })
      .where(or(eq(enterprises.enterprise_id, enterprise_id), eq(enterprises.parent_id, enterprise_id)))
      .returning({ id: enterprises.enterprise_id });
    return rows.length;
  }

  async delete(enterprise_id: string): Promise<boolean> {
    const rows = await this.db.delete(enterprises).where(eq(enterprises.enterprise_id, enterprise_id)).returning({ id: enterprises.enterprise_id });
    return rows.length > 0;
  }
}

function toView(r: { row: Row; parent_name: string | null; user_count: number; device_count: number; branch_count: number }): EnterpriseView {
  return {
    enterprise_id: r.row.enterprise_id,
    parent_id: r.row.parent_id,
    parent_name: r.parent_name,
    code: r.row.code,
    name: r.row.name,
    tax_code: r.row.tax_code,
    address: r.row.address,
    phone: r.row.phone,
    email: r.row.email,
    contact_name: r.row.contact_name,
    status: r.row.status,
    max_users: r.row.max_users,
    user_count: r.user_count,
    device_count: r.device_count,
    branch_count: r.branch_count,
    created_at: r.row.created_at.toISOString(),
    updated_at: r.row.updated_at.toISOString(),
  };
}

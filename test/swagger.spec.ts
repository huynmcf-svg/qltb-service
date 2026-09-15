import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument } from '../src/swagger';

/**
 * Ép luật tài liệu bằng test, không bằng lời nhắc trong MR.
 *
 * Luật ở `qltb-workspace/docs/conventions.md` mục "Swagger": mọi endpoint phải
 * có `summary` và `description` tiếng Việt, và mọi response 2xx phải có ví dụ
 * bọc envelope (trừ /health — body trần có chủ đích).
 *
 * Không cần database: Pool của pg mở kết nối lazy, dựng module thì chưa query.
 */
describe('tài liệu Swagger', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    await app.init();
    document = buildSwaggerDocument(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

  function operations(): Array<{ path: string; method: string; op: OperationObject }> {
    const out: Array<{ path: string; method: string; op: OperationObject }> = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (op) out.push({ path, method, op });
      }
    }
    return out;
  }

  it('có ít nhất một endpoint', () => {
    expect(operations().length).toBeGreaterThan(0);
  });

  it('mọi endpoint có summary và description', () => {
    const missing = operations()
      .filter(({ op }) => !op.summary?.trim() || !op.description?.trim())
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it('description phải dài hơn summary — nói điều người gọi chưa biết', () => {
    const thin = operations()
      .filter(({ op }) => (op.description?.length ?? 0) <= (op.summary?.length ?? 0))
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(thin).toEqual([]);
  });

  it('mọi response 2xx có ví dụ', () => {
    const missing: string[] = [];
    for (const { method, path, op } of operations()) {
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        if (!status.startsWith('2') || status === '204') continue;
        const content = (response as { content?: Record<string, { example?: unknown }> }).content ?? {};
        // Endpoint trả FILE (báo cáo) khai content-type khác JSON — ví dụ là mô tả file, chấp nhận.
        const example = Object.values(content).find((c) => c.example !== undefined)?.example;
        if (example === undefined) missing.push(`${method.toUpperCase()} ${path} → ${status}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('ví dụ response của endpoint nghiệp vụ bọc envelope', () => {
    const bad: string[] = [];
    for (const { method, path, op } of operations()) {
      if (path.startsWith('/health')) continue;
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        if (status === '204') continue;
        const content = (response as { content?: Record<string, { example?: unknown }> }).content;
        const example = content?.['application/json']?.example as Record<string, unknown> | undefined;
        if (!example) continue;
        const isEnvelope = 'request_id' in example && 'data' in example && 'error' in example;
        if (!isEnvelope) bad.push(`${method.toUpperCase()} ${path} → ${status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('ví dụ lỗi nêu error.code cụ thể', () => {
    const bad: string[] = [];
    for (const { method, path, op } of operations()) {
      if (path.startsWith('/health')) continue;
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        if (!status.startsWith('4') && !status.startsWith('5')) continue;
        const content = (response as { content?: Record<string, { example?: unknown }> }).content;
        const example = content?.['application/json']?.example as
          | { error?: { code?: unknown } }
          | undefined;
        if (typeof example?.error?.code !== 'string' || !example.error.code) {
          bad.push(`${method.toUpperCase()} ${path} → ${status}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

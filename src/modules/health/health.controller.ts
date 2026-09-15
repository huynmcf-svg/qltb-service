import { Controller, Get, Inject, Logger, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { NoEnvelope, Public } from '../../common/decorators';
import { DRIZZLE, type Db } from '../../db/drizzle.module';

const SERVICE = 'qltb-service';

/**
 * `/health` nằm NGOÀI prefix `/api/v1` và ngoài guard. Body TRẦN, không envelope.
 */
@ApiTags('health')
@NoEnvelope()
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private lastDbStatus: 'ok' | 'down' | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness — tiến trình còn sống',
    description:
      'Nằm **ngoài** prefix `/api/v1` và ngoài guard. LUÔN 200 khi tiến trình còn ' +
      'trả lời được, **kể cả lúc database sập** — muốn biết DB thì gọi `/health/ready`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tiến trình còn sống. Body TRẦN, không envelope.',
    content: {
      'application/json': {
        example: { status: 'ok', service: SERVICE, ts: '2026-09-15T06:30:00.000Z' },
      },
    },
  })
  live() {
    return { status: 'ok', service: SERVICE, ts: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness — database đã sẵn sàng chưa',
    description:
      'Trả `503` khi không `select 1` được tới PostgreSQL. Dùng cho probe của hạ tầng ' +
      'và để dev kiểm tra nhanh chuỗi kết nối.',
  })
  @ApiResponse({
    status: 200,
    description: 'Database sẵn sàng.',
    content: {
      'application/json': {
        example: { status: 'ok', service: SERVICE, db: 'ok', ts: '2026-09-15T06:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Database không trả lời.',
    content: {
      'application/json': {
        example: { status: 'degraded', service: SERVICE, db: 'down', ts: '2026-09-15T06:30:00.000Z' },
      },
    },
  })
  async ready(@Res({ passthrough: true }) res: Response) {
    const db = await this.checkDb();
    const ok = db === 'ok';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', service: SERVICE, db, ts: new Date().toISOString() };
  }

  private async checkDb(): Promise<'ok' | 'down'> {
    try {
      await this.db.execute(sql`select 1`);
      this.reportDbStatus('ok');
      return 'ok';
    } catch (error) {
      this.reportDbStatus('down', error);
      return 'down';
    }
  }

  /** Chỉ log khi trạng thái ĐỔI — probe gọi liên tục, log mỗi lần là ngập. */
  private reportDbStatus(status: 'ok' | 'down', error?: unknown) {
    if (status === this.lastDbStatus) return;
    if (status === 'down') {
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      this.logger.error(`readiness check failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } else if (this.lastDbStatus === 'down') {
      this.logger.log('readiness recovered: database reachable again');
    }
    this.lastDbStatus = status;
  }
}

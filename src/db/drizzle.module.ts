import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE = Symbol('DRIZZLE');

export type Db = NodePgDatabase<typeof schema>;

/**
 * Một pool duy nhất cho cả tiến trình. `@Global()` để không phải import lại ở
 * từng module nghiệp vụ.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('PgPool');
        const connectionString = config.getOrThrow<string>('database.url');
        if (process.env.VERCEL && !connectionString.includes('-pooler')) {
          logger.warn(
            'Vercel nên dùng Neon pooled URL (hostname có -pooler) để tránh hết max_connections',
          );
        }
        const pool = new Pool({
          connectionString,
          max: config.get<number>('database.poolMax'),
          // Tính cả thời gian xếp hàng chờ kết nối rảnh trong pool.
          connectionTimeoutMillis: config.get<number>('database.connectTimeoutMs'),
          keepAlive: true,
        });
        /*
         * pg-pool emit 'error' khi một kết nối ĐANG RẢNH trong pool bị đứt
         * (DB restart, mạng rớt). Không có listener thì EventEmitter ném lỗi
         * lên tiến trình và service chết dù không có query nào đang chạy.
         */
        pool.on('error', (error) => {
          logger.error(`kết nối rảnh trong pool bị đứt: ${error.message}`);
        });
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

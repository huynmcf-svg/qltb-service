import { Global, Module } from '@nestjs/common';
import { AppLogger } from '../../common/logger/app-logger.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** `@Global()` vì gần như mọi module nghiệp vụ đều phải ghi audit. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AppLogger],
  exports: [AuditService],
})
export class AuditModule {}

import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { ReportController } from './report.controller';

@Module({
  imports: [DeviceModule, EnterpriseModule],
  controllers: [ReportController],
})
export class ReportModule {}

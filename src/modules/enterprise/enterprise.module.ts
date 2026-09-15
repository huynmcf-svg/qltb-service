import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { UserModule } from '../user/user.module';
import { EnterpriseController } from './enterprise.controller';
import { EnterpriseRepository } from './enterprise.repository';
import { EnterpriseService } from './enterprise.service';

@Module({
  imports: [DeviceModule, UserModule],
  controllers: [EnterpriseController],
  providers: [EnterpriseService, EnterpriseRepository],
  exports: [EnterpriseService, EnterpriseRepository],
})
export class EnterpriseModule {}

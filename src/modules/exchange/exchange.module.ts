import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { ExchangeController } from './exchange.controller';
import { ExchangeRepository } from './exchange.repository';
import { ExchangeService } from './exchange.service';

@Module({
  imports: [DeviceModule],
  controllers: [ExchangeController],
  providers: [ExchangeService, ExchangeRepository],
})
export class ExchangeModule {}

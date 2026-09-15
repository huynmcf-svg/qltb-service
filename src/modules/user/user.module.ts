import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthRepository } from '../auth/auth.repository';
import { EnterpriseRepository } from '../enterprise/enterprise.repository';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UserController],
  providers: [UserService, UserRepository, AuthRepository, EnterpriseRepository],
  exports: [UserService, UserRepository],
})
export class UserModule {}

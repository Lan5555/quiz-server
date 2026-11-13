import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../common/voting-core.module';
import { VotingAdminGuard, VotingAuthService } from './voting-auth.service';
import { VotingAuthController } from './voting-auth.controller';
@Module({
  imports: [VotingCoreModule],
  providers: [VotingAuthService, VotingAdminGuard],
  controllers: [VotingAuthController],
  exports: [VotingAuthService, VotingAdminGuard, VotingCoreModule],
})
export class VotingAuthModule {}

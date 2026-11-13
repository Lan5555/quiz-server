import { Module } from '@nestjs/common';
import { VotingConfig } from './voting';
import { VotingRateGuard } from './voting-rate.guard';
@Module({
  providers: [VotingConfig, VotingRateGuard],
  exports: [VotingConfig, VotingRateGuard],
})
export class VotingCoreModule {}

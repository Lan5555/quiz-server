import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../../voting/common/voting-core.module';
import { VotingPaymentsModule } from '../../voting/payments/voting-payments.module';
import { GameCheckoutService } from './game-checkout.service';

@Module({
  imports: [VotingCoreModule, VotingPaymentsModule],
  providers: [GameCheckoutService],
  exports: [GameCheckoutService],
})
export class GameCheckoutModule {}

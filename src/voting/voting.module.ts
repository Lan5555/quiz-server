import { Module } from '@nestjs/common';
import { VotingCoreModule } from './common/voting-core.module';
import { VotingAuthModule } from './auth/voting-auth.module';
import { PollsModule } from './polls/polls.module';
import { CandidatesModule } from './candidates/candidates.module';
import { PurchasesModule } from './purchases/purchases.module';
import { VotingPaymentsModule } from './payments/voting-payments.module';
import { VotingController, VotingWebhookController } from './voting.controller';
import { VotingImagesModule } from './images/images.module';
import { GameCheckoutModule } from '../game/payments/game-checkout.module';
@Module({
  imports: [
    VotingCoreModule,
    VotingAuthModule,
    PollsModule,
    CandidatesModule,
    PurchasesModule,
    VotingPaymentsModule,
    VotingImagesModule,
    GameCheckoutModule,
  ],
  controllers: [VotingController, VotingWebhookController],
})
export class VotingModule {}

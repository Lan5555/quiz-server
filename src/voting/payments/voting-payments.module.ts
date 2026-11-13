import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../common/voting-core.module';
import { FlutterwaveService } from './flutterwave.service';
import { VoteAccountingService } from './vote-accounting.service';
import { VotingWebhooksService } from './voting-webhooks.service';
import { VotingReconciliationService } from './voting-reconciliation.service';
@Module({
  imports: [VotingCoreModule],
  providers: [
    FlutterwaveService,
    VoteAccountingService,
    VotingWebhooksService,
    VotingReconciliationService,
  ],
  exports: [FlutterwaveService, VoteAccountingService, VotingWebhooksService],
})
export class VotingPaymentsModule {}

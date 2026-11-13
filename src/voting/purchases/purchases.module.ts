import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../common/voting-core.module';
import { VotingPaymentsModule } from '../payments/voting-payments.module';
import { ReceiptTokenService } from './receipt-token.service';
import { PurchasesService } from './purchases.service';
@Module({
  imports: [VotingCoreModule, VotingPaymentsModule],
  providers: [ReceiptTokenService, PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}

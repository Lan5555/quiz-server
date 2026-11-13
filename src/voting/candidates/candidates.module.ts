import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../common/voting-core.module';
import { CandidatesService } from './candidates.service';
import { VotingImagesModule } from '../images/images.module';
@Module({
  imports: [VotingCoreModule, VotingImagesModule],
  providers: [CandidatesService],
  exports: [CandidatesService],
})
export class CandidatesModule {}

import { Module } from '@nestjs/common';
import { VotingCoreModule } from '../common/voting-core.module';
import { PollsService } from './polls.service';
import { VotingImagesModule } from '../images/images.module';
@Module({
  imports: [VotingCoreModule, VotingImagesModule],
  providers: [PollsService],
  exports: [PollsService],
})
export class PollsModule {}

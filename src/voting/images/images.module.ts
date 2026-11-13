import { Module } from '@nestjs/common';
import { VotingAuthModule } from '../auth/voting-auth.module';
import { VotingCoreModule } from '../common/voting-core.module';
import { VotingImagesController } from './images.controller';
import { VotingImagesService } from './images.service';
@Module({
  imports: [VotingAuthModule, VotingCoreModule],
  controllers: [VotingImagesController],
  providers: [VotingImagesService],
  exports: [VotingImagesService],
})
export class VotingImagesModule {}

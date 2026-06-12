import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewResponse } from 'src/entities/entity';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { MiscModule } from 'src/misc/misc.module';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewResponse]), MiscModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}

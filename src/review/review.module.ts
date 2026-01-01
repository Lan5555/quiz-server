import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewResponse } from 'src/entities/entity';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewResponse])],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}

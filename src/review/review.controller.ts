import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewResponseDto } from 'src/validators/review_response.dto';

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}
  @Post('/api/log-responses')
  saveUserResponses(@Body() body: ReviewResponseDto) {
    return this.reviewService.saveResponse(body);
  }
  @Get('/api/fetch-reviews')
  fetchReviews(@Query('userId') userId: number) {
    return this.reviewService.fetchReviews(Number(userId));
  }
}

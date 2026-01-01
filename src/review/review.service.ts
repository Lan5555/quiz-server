import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ReviewResponse } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import { ReviewResponseDto } from 'src/validators/review_response.dto';
import { Repository } from 'typeorm';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewResponse)
    private readonly reviewResponse: Repository<ReviewResponse>,
  ) {}

  async saveResponse(response: ReviewResponseDto): Promise<NetResponse> {
    try {
      const alreadyTaken = await this.reviewResponse.findOne({
        where: {
          userId: response.userId,
          taken: true,
        },
      });

      if (alreadyTaken) {
        return {
          success: false,
          message: 'User has already submitted a review',
          data: null,
        };
      }

      const review = this.reviewResponse.create({
        ...response,
        taken: true, // enforce server-side
      });

      const savedReview = await this.reviewResponse.save(review);

      return {
        success: true,
        message: 'Review Saved Successfully',
        data: savedReview,
      };
    } catch (error) {
      return {
        success: false,
        message: error as string,
        data: null,
      };
    }
  }

  async fetchReviews(userId: number): Promise<NetResponse> {
    try {
      const reviewResponse = await this.reviewResponse.findBy({ userId });
      if (reviewResponse) {
        return {
          success: true,
          message: 'Reviews queried successfully',
          data: reviewResponse,
        };
      }
    } catch (e) {
      return {
        success: false,
        message: `${e}`,
        data: null,
      };
    }
    return {
      success: false,
      message: 'Unable to fetch Reviews',
      data: null,
    };
  }
}

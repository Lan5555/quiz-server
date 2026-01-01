import { IsArray, IsBoolean, IsInt, IsString } from 'class-validator';
import * as types from 'src/helpers/types';

export class ReviewResponseDto {
  @IsInt()
  userId: number;
  @IsString()
  name: string;
  @IsString()
  subtitle: string;
  @IsString()
  completedDate: string;
  @IsArray()
  review: types.Review[];
  @IsBoolean()
  taken: boolean;
  @IsString()
  quizName: string;
  @IsInt()
  score: number;
  @IsInt()
  timeSpent: number;
  @IsInt()
  totalQuestions: number;
}

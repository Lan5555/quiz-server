import { IsString, IsArray, IsNumber, ArrayNotEmpty } from 'class-validator';

export class QuestionItemDto {
  @IsString()
  question: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  options: string[];

  @IsNumber()
  correct: number;
}

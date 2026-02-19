import { Type } from 'class-transformer';
import {
  IsString,
  IsArray,
  IsNumber,
  ArrayNotEmpty,
  ValidateNested,
  IsInt,
  IsBoolean,
} from 'class-validator';
import { QuestionItemDto } from './question_item.dto';

export class CreateQuestionDto {
  @IsString()
  name: string;

  @IsInt()
  code: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => QuestionItemDto)
  question: QuestionItemDto[];

  @IsNumber()
  totalQuestions: number;

  @IsBoolean()
  isDynamic: boolean;

  @IsInt()
  dynamicTime: number;
}

export class fetchQuestionsDto {
  @IsInt()
  id: number;
}

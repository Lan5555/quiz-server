import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { QuestionService } from './question.service';
import {
  CreateQuestionDto,
  fetchQuestionsDto,
} from 'src/validators/question.dto';

@Controller('question')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  @Post('/api/save-quiz')
  saveQuestions(@Body() body: CreateQuestionDto) {
    return this.questionService.saveQuestions(body);
  }
  @Get('/api/get-questions')
  fetchQuestions(@Query('id') id?: number) {
    return this.questionService.fetchQuestions(Number(id) || 0);
  }
  @Get('/api/get-stats')
  getStats() {
    return this.questionService.getStats();
  }

  @Delete('/api/delete-quiz')
  deleteQuiz(@Body() quizId: number) {
    return this.questionService.deleteQuiz(quizId);
  }

  @Post('/api/verify-quiz-id')
  verifyQuizId(@Body() body: fetchQuestionsDto) {
    return this.questionService.verifyQuestionId(body.id);
  }

  @Get('/api/fetch-all-questions')
  fetchAllQuestions(
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.questionService.fetchAllQuiz(
      Number(take) || 0,
      Number(skip) || 0,
    );
  }
}

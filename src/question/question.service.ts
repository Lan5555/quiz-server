import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import { CreateQuestionDto } from 'src/validators/question.dto';
import { Repository } from 'typeorm';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(Question)
    private readonly questionDb: Repository<Question>,
  ) {}

  async saveQuestions(questions: CreateQuestionDto): Promise<NetResponse> {
    // Remove id to avoid PK conflicts
    const questionEntity = this.questionDb.create({
      name: questions.name,
      code: questions.code,
      question: questions.question, // already an array
      totalQuestions: questions.totalQuestions,
    });

    await this.questionDb.save(questionEntity);

    return {
      success: true,
      message: 'Questions saved successfully',
      data: {
        count: questionEntity.totalQuestions,
      },
    };
  }

  async fetchQuestions(code: number): Promise<NetResponse> {
    const questions = await this.questionDb.findOneBy({
      code,
    });
    if (questions) {
      return {
        success: true,
        message: 'Questions gotten successfully',
        data: questions,
      };
    }
    return {
      success: false,
      message: 'No questions available for quiz id provided',
      data: null,
    };
  }
  async getStats(): Promise<NetResponse> {
    const question = await this.questionDb.find();
    if (question) {
      return {
        success: true,
        message: 'Fetched questions successfully',
        data: {
          totalQuizzes: question.length,
          totalQuestions: question.reduce((u, a) => u + a.question.length, 0),
        },
      };
    }
    return {
      success: false,
      message: '',
      data: {},
    };
  }

  async deleteQuiz(id: number): Promise<NetResponse> {
    await this.questionDb.delete({ id });
    return {
      success: true,
      message: 'Deleted successfully',
      data: null,
    };
  }

  async verifyQuestionId(code: number): Promise<NetResponse> {
    const question = await this.questionDb.findOneBy({ code });
    if (question) {
      return {
        success: true,
        message: 'Quiz available for provided id',
        data: null,
      };
    }
    return {
      success: false,
      message: 'No quiz available for provided id',
      data: null,
    };
  }

  async fetchAllQuiz(take: number, skip: number): Promise<NetResponse> {
    const questions = await this.questionDb.find({
      take: take,
      skip: skip,
      order: { id: 'ASC' },
    });
    if (questions) {
      return {
        success: true,
        message: 'Queried successfullly',
        data: questions,
      };
    }
    return {
      success: false,
      message: 'No questions available',
      data: null,
    };
  }
}

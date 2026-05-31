import { Injectable } from '@nestjs/common';
import { LessThanOrEqual, Repository } from 'typeorm';
import { User } from '../entities/entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class CronJobService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async updateUserQuizAttempt() {
    const users = await this.userRepository.find({
      where: { deadline: LessThanOrEqual(new Date()) },
    });
    const toUpdate = users.map((user) => ({
      ...user,
      codeInfo: { ...user.codeInfo, attempts: user.codeInfo.attempts + 1 },
      deadline: null,
    }));

    await this.userRepository.save(toUpdate);
  }
}

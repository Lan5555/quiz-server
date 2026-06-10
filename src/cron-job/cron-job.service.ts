import { Injectable } from '@nestjs/common';
import { LessThanOrEqual, Repository } from 'typeorm';
import { User } from '../entities/entity';
import { InjectRepository } from '@nestjs/typeorm';
import { EmailServiceService } from 'src/email-service/email-service.service';

@Injectable()
export class CronJobService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly emailService: EmailServiceService,
  ) {}

  async updateUserQuizAttempt() {
    const users = await this.userRepository.find({
      where: { deadline: LessThanOrEqual(new Date()) },
    });

    const today = new Date().toDateString();
    const sendEmailToReadyUser = users.filter(
      (user) =>
        user.deadline && new Date(user.deadline).toDateString() === today,
    );
    console.log(sendEmailToReadyUser);
    const toUpdate = users.map((user) => ({
      ...user,
      codeInfo: { ...user.codeInfo, attempts: user.codeInfo.attempts + 1 },
      deadline: null,
    }));
    if (sendEmailToReadyUser.length > 0) {
      await Promise.all(
        sendEmailToReadyUser.map((user) =>
          this.emailService.sendEmail(
            user.email,
            'Quiz Attempt Update',
            `Dear ${user.name}, your quiz attempt has been updated. You now have ${user.codeInfo.attempts} attempts. Please check your account for more details.`,
            'notification',
          ),
        ),
      );
    }
    await this.userRepository.save(toUpdate);
  }
}

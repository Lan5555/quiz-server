import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/entity';
import { NetResponse } from '../helpers/types';
import { PayedDto } from '../validators/shop.dto';
import { UserDto } from '../validators/user.dto';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CronJobService } from 'src/cron-job/cron-job.service';
import { EmailServiceService } from 'src/email-service/email-service.service';
import { Misc } from 'src/misc/entities/misc.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cronjobService: CronJobService,
    private readonly emailService: EmailServiceService,
    @InjectRepository(Misc) private readonly miscRepository: Repository<Misc>,
  ) {}

  async saveUserData(userDetails: UserDto): Promise<NetResponse> {
    const user = this.userRepository.create(userDetails);

    await this.userRepository.save(user);
    return {
      success: true,
      message: 'User successfully added to database',
      data: null,
    };
  }

  async findAll(): Promise<NetResponse> {
    const users = await this.userRepository.find();
    if (users) {
      return {
        success: true,
        message: 'Available users',
        data: users,
      };
    }
    return {
      success: false,
      message: 'An error occured',
      data: null,
    };
  }

  async findUserById(userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

    if (user) {
      return {
        success: true,
        message: 'User found successfully',
        data: user,
      };
    }

    return {
      success: false,
      message: 'User not found',
      data: {},
    };
  }

  async findUserByName(name: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ name });
    if (user) {
      return {
        success: true,
        message: 'User found successfully',
        data: user,
      };
    }
    return {
      success: false,
      message: 'User not found',
      data: {},
    };
  }

  async checkUserCode(email: string, code: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ email });

    if (!user || !user.codeInfo) {
      return {
        success: false,
        message: 'User not found',
        data: {},
      };
    }

    const { code: storedCode, attempts } = user.codeInfo;

    if (attempts <= 0) {
      return {
        success: false,
        message: 'Code usage limit exceeded',
        data: {},
      };
    }

    if (storedCode !== code) {
      return {
        success: false,
        message: 'Invalid code',
        data: {},
      };
    }

    const newAttempts = attempts - 1;

    await this.userRepository.update(
      { userId: user.userId },
      {
        codeInfo: {
          ...user.codeInfo,
          attempts: newAttempts,
        },
      },
    );

    return {
      success: true,
      message: `Welcome ${user.name}`,
      data: {
        username: user.name,
        userId: user.userId,
        attempts: newAttempts,
        time: user.time,
        token: uuidv4(),
      },
    };
  }

  async saveUserScore(userId: number, value: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user.score = value;
    await this.userRepository.save(user); // ✅ updates Neon correctly

    return {
      success: true,
      message: 'Score saved successfully',
      data: null,
    };
  }

  logInAdmin(password: string): NetResponse {
    if (password['password'] == 'zelink123') {
      const dataResponse = {
        name: 'Nicholas Johnson',
        email: 'okekejohnson24@gmail.com',
        level: 3,
        token: uuidv4(),
      };
      return {
        success: true,
        message: 'Welcome back admin',
        data: dataResponse,
      };
    }
    return {
      success: false,
      message: 'Invalid Credentials',
      data: null,
    };
  }

  async updateUserCode(
    userId: number,
    code: string,
    uses: number,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user.codeInfo = { ...user.codeInfo, code, attempts: uses };
    await this.userRepository.save(user); // updates JSON properly

    return {
      success: true,
      message: 'User code updated successfully',
      data: null,
    };
  }

  async deleteUser(userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'Unable to delete user',
        data: null,
      };
    }

    await this.userRepository.remove(user); // ✅ deletes the correct row

    return {
      success: true,
      message: `${user.name} deleted successfully`,
      data: null,
    };
  }

  async updateParam(
    userId: number,
    key: 'email' | 'name',
    param: string,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user[key] = param; // ✅ update property dynamically
    await this.userRepository.save(user); // ✅ ensures Neon gets the update

    return {
      success: true,
      message: 'User parameter updated successfully',
      data: null,
    };
  }

  async pingServer(): Promise<NetResponse> {
    await this.cronjobService.updateUserQuizAttempt();
    return {
      success: true,
      message: ' success',
      data: null,
    };
  }

  async logInStudent(email: string, code: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ email });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    } else if (user.email === email && user.codeInfo.code === code) {
      return {
        success: true,
        message: `Welcome back ${user.name}`,
        data: {
          ...user,
          token: uuidv4(),
        },
      };
    } else {
      return {
        success: false,
        message: 'Invalid Credentials',
        data: null,
      };
    }
  }

  async updateUserItems(val: PayedDto, userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    // Update the fields
    switch (val.productId) {
      case 1: {
        // attempts
        user.codeInfo = {
          ...user.codeInfo,
          attempts: (user.codeInfo?.attempts || 0) + (val.params.attempts || 0),
        };

        const emailMessage =
          user.quizId != null
            ? `Your quiz attempt count has been updated. You now have ${user.codeInfo.attempts} attempts for quiz ID ${user.quizId}. Please check your account for more details.`
            : `Your quiz attempt count has been updated. You now have ${user.codeInfo.attempts} attempts. Please check your account for more details.`;

        await this.emailService.sendEmail(
          user.email,
          'Quiz Attempt Update',
          emailMessage,
          'notification',
        );
        break;
      }

      case 2: // time
        user.time = (user.time || 0) + (val.params.time || 0);
        await this.emailService.sendEmail(
          user.email,
          'Quiz Time Update',
          `Dear ${user.name}, your new quiz time is ${user.time}. Please check your account for more details.`,
          'notification',
        );
        break;
      case 3:
        await this.miscRepository.save({
          key: userId.toString(),
          value: val.params.quizKey,
        });
        await this.emailService.sendEmail(
          user.email,
          'Quiz Key Update',
          `Dear ${user.name}, your new quiz reveal key is set to ${val.params.quizKey}. Please use this key to reveal your quiz.`,
          'notification',
        );
        break;

      default: // fallback
        user.codeInfo = {
          ...user.codeInfo,
          attempts: (user.codeInfo?.attempts || 0) + (val.params.attempts || 0),
        };
        break;
    }

    await this.userRepository.save(user); // ✅ ensures Neon updates JSON correctly

    return {
      success: true,
      message:
        val.productId === 3
          ? 'Quiz key updated successfully kindly check your email'
          : 'User items pdated successfully',
      data: user,
    };
  }

  async updateUserCodeAttemt(
    userId: number,
    attempts: number,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }
    user.codeInfo = {
      ...user.codeInfo,
      attempts: attempts,
    };
    await this.userRepository.save(user); // updates JSON properly
    return {
      success: true,
      message: 'User code attempts updated successfully',
      data: null,
    };
  }

  async updateUserTime(userId: number, time: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }
    user.time = time;
    await this.userRepository.save(user);
    return {
      success: true,
      message: 'User time updated successfully',
      data: null,
    };
  }

  async updateDeadLine(
    userId: number,
    deadline: Date,
    quizId: number,
  ): Promise<NetResponse> {
    try {
      const user = await this.userRepository.findOneBy({ userId });
      if (!user) {
        return {
          success: false,
          message: 'User not found',
          data: null,
        };
      }
      user.deadline = deadline;
      user.quizId = quizId;
      await this.userRepository.save(user);
      await this.emailService.sendEmail(
        user.email,
        'Deadline Update Notification',
        `Dear ${user.name}, your new quiz date is set to ${new Date(
          deadline,
        ).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}. Please make sure to complete your quiz on the official quiz day set.`,
        'notification',
      );
      return {
        success: true,
        message: 'User deadline updated successfully',
        data: null,
      };
    } catch (e: unknown) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'An unknown error occurred',
        data: null,
      };
    }
  }
}

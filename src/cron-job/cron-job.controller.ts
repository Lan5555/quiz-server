import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { CronJobService } from './cron-job.service';

@Controller('cron-job')
export class CronJobController {
  constructor(private readonly cronJobService: CronJobService) {}
  @Get('update-deadlines')
  async updateDeadlines(@Headers('x-cron-secret') secret: string) {
    if (secret !== process.env.CRON_SECRET) {
      throw new UnauthorizedException();
    }

    await this.cronJobService.updateUserQuizAttempt();

    return {
      success: true,
    };
  }
}

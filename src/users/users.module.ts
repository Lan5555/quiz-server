import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/entity';
import { CronJobService } from 'src/cron-job/cron-job.service';
import { EmailServiceService } from 'src/email-service/email-service.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService, CronJobService, EmailServiceService],
})
export class UsersModule {}

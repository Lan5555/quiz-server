import { Module } from '@nestjs/common';
import { CronJobService } from './cron-job.service';
import { CronJobController } from './cron-job.controller';
import { User } from 'src/entities/entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [CronJobController],
  providers: [CronJobService],
})
export class CronJobModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { QuestionModule } from './question/question.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReviewModule } from './review/review.module';
import { ShopModule } from './shop/shop.module';
import { PurchaseTicketModule } from './purchase-ticket/purchase-ticket.module';
import { CronJobModule } from './cron-job/cron-job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailServiceModule } from './email-service/email-service.module';
import { MiscModule } from './misc/misc.module';
import { ChatModule } from './chat/chat.module';
import { JwtModule } from '@nestjs/jwt';
import { GameModule } from './game/game.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? '.env.production'
          : '.env.development',
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'Lan-Hub-v3',
        signOptions: { expiresIn: '1h' },
      }),
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        //host: config.get<string>('DB_HOST'),
        url: config.get<string>('DATABASE_URL'),
        // port: Number(config.get<number>('DB_PORT')),
        // username: config.get<string>('DB_USER'),
        // password: config.get<string>('DB_PASSWORD'),
        // database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: process.env.NODE_ENV !== 'production',
        ssl: { rejectUnauthorized: false },
      }),
    }),

    UsersModule,
    QuestionModule,
    ReviewModule,
    ShopModule,
    PurchaseTicketModule,
    CronJobModule,
    EmailServiceModule,
    MiscModule,
    ChatModule,
    GameModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  User,
  Question,
  ReviewResponse,
  Shop,
  PurchaseTicket,
} from './entities/entity';
import { Misc } from './misc/entities/misc.entity';
import { PaidVoting1794528000000 } from './migrations/1794528000000-PaidVoting';
import { FlutterwaveVoting1794614400000 } from './migrations/1794614400000-FlutterwaveVoting';
import { VotingImages1794700800000 } from './migrations/1794700800000-VotingImages';
import { FlutterwaveKeyScopedVoting1794787200000 } from './migrations/1794787200000-FlutterwaveKeyScopedVoting';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  ssl:
    process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
  entities: [User, Question, ReviewResponse, Shop, PurchaseTicket, Misc],
  migrations: [
    PaidVoting1794528000000,
    FlutterwaveVoting1794614400000,
    VotingImages1794700800000,
    FlutterwaveKeyScopedVoting1794787200000,
  ],
  subscribers: [],
});

// Deployment supplies DATABASE_URL. Do not load secret files or initialize on import.

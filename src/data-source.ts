import { EmbraceEncounterCheckpoints1795305600000 } from './migrations/1795305600000-EmbraceEncounterCheckpoints';
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
import { EmbraceProgression1794873600000 } from './migrations/1794873600000-EmbraceProgression';
import { FlutterwaveKeyScopedVoting1794787200000 } from './migrations/1794787200000-FlutterwaveKeyScopedVoting';
import { EmbraceShopAndExperience1795219200000 } from './migrations/1795219200000-EmbraceShopAndExperience';
import { EmbraceFighters1795132800000 } from './migrations/1795132800000-EmbraceFighters';
import { EmbraceCheckout1794960000000 } from './migrations/1794960000000-EmbraceCheckout';
import { EmbraceAdmin1795046400000 } from './migrations/1795046400000-EmbraceAdmin';

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
    EmbraceProgression1794873600000,
    EmbraceCheckout1794960000000,
    EmbraceFighters1795132800000,
    EmbraceAdmin1795046400000,
    EmbraceShopAndExperience1795219200000,
    EmbraceEncounterCheckpoints1795305600000,
  ],
  subscribers: [],
});

// Deployment supplies DATABASE_URL. Do not load secret files or initialize on import.

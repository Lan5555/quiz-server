import 'reflect-metadata';
import { DataSource } from 'typeorm';

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

export const AppDataSource = new DataSource({
  type: 'mysql', // or postgres
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  logging: true,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
  subscribers: [],
});

//Optional: initialize immediately
AppDataSource.initialize()
  .then(() => console.log('Data Source initialized'))
  .catch((err) =>
    console.error('Error during Data Source initialization', err),
  );

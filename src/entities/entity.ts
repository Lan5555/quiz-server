import * as types from 'src/helpers/types';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column('json')
  codeInfo: types.CodeStat;

  @Column()
  score: number;

  @Column()
  time: number;
}

@Entity()
export class Question {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  code: number;

  @Column({ type: 'json' })
  question: {
    question: string;
    options: string[];
    correct: number;
  }[];

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  totalQuestions: number;

  @Column()
  isDynamic: boolean;

  @Column()
  dynamicTime: number;
}

@Entity()
export class ReviewResponse {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;
  @Column()
  name: string;
  @Column()
  subtitle: string;
  @CreateDateColumn()
  completedDate: string;
  @Column({ type: 'json' })
  review: types.Review[];
  @Column()
  taken: boolean;
  @Column()
  quizName: string;
  @Column()
  score: number;
  @Column()
  timeSpent: number;
  @Column()
  totalQuestions: number;
}

@Entity()
export class Shop {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  name: string;
  @Column()
  price: number;
  @Column()
  icon: string;
  @Column()
  description: string;
}

@Entity()
export class PurchaseTicket {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  ticketId: string;
  @Column()
  name: string;
  @Column()
  phone: string;
  @Column()
  price: number;
  @Column()
  email: string;
  @Column()
  purchaseDate: string;
}

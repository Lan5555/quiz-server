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
  name: string;

  @Column({ unique: true })
  email: string;

  @Column('json')
  codeInfo: types.CodeStat;

  @Column()
  score: number;
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
}

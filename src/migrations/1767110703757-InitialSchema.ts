import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1767110703757 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE user (
         id INT PRIMARY KEY AUTO_INCREMENT,
         name VARCHAR(255) NOT NULL,
         email VARCHAR(255) NOT NULL UNIQUE,
         codeInfo JSON,
         score INT
        );
        `,
    );
    await queryRunner.query(
      `CREATE TABLE question (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        totalQuestions INT NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE,
        questions JSON NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE user;`);
    await queryRunner.query(`DROP TABLE question`);
  }
}

import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('misc')
export class Misc {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;
}

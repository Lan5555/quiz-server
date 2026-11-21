import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('game_gear')
export class GameGear {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ name: 'gear_id', unique: true })
  gearId!: string;
  @Column()
  name!: string;
  @Column()
  slot!: string;
  @Column()
  rarity!: string;
  @Column()
  attack!: number;
  @Column()
  armor!: number;
  @Column()
  price!: number;
  @Column({ name: 'paid', default: false })
  paid!: boolean;
  @Column({ name: 'cash_amount_minor', type: 'integer', nullable: true })
  cashAmountMinor!: number | null;
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;
  @CreateDateColumn()
  created_at!: Date;
}

import {
  IsBoolean,
  IsIn,
  IsInt,
  Length,
  Matches,
  Min,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class GameGearDto {
  @Matches(/^[a-z][a-z0-9_]*$/)
  gearId!: string;
  @Length(2, 60)
  name!: string;
  @IsIn(['weapon', 'armor'])
  slot!: string;
  @IsIn(['common', 'rare', 'legendary'])
  rarity!: string;
  @IsInt()
  @Min(0)
  attack!: number;
  @IsInt()
  @Min(0)
  armor!: number;
  @IsInt()
  @Min(0)
  price!: number;
  @IsBoolean()
  paid!: boolean;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  @ValidateIf((gear) => gear.paid)
  @IsInt()
  @Min(100)
  cashAmountMinor?: number;
  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)/)
  imageUrl?: string;
}

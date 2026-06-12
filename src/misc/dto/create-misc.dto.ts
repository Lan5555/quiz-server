import { IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateMiscDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key!: string;

  @IsString()
  @IsNotEmpty()
  value!: string;
}

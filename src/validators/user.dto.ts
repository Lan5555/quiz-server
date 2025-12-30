import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsInt()
  @IsOptional()
  id: number;

  @IsString()
  @IsOptional()
  @MinLength(6)
  code: string;

  @IsOptional()
  codeInfo: Record<string, any>;

  @IsInt()
  @IsOptional()
  score: number;
}

export class SaveScoreDto {
  @IsInt()
  id: number;
  @IsInt()
  score: number;
}

export class OneUserDto {
  @IsInt()
  id: number;
}

export class ParameterDto {
  @IsInt()
  id: number;
  @IsString()
  key: 'email' | 'name';
  @IsString()
  param: string;
}

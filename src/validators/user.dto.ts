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

  @IsInt()
  @IsOptional()
  userId: number;

  @IsString()
  @IsOptional()
  @MinLength(6)
  code: string;

  @IsOptional()
  codeInfo: Record<string, any>;

  @IsInt()
  @IsOptional()
  score: number;

  @IsInt()
  @IsOptional()
  time: number;
}

export class SaveScoreDto {
  @IsInt()
  userId: number;
  @IsInt()
  score: number;
}

export class OneUserDto {
  @IsInt()
  userId: number;
}

export class ParameterDto {
  @IsInt()
  userId: number;
  @IsString()
  key: 'email' | 'name';
  @IsString()
  param: string;
}

export class StudentDto {
  @IsEmail()
  email: string;
  @IsString()
  code: string;
}

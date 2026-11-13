import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class CreatePollDto {
  @IsOptional() @IsUUID() imageId?: string | null;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) title: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  description: string;
  @Equals('NGN') currency: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) votePriceMinor: number;
  @IsInt() @Min(1) @Max(100000) maxVotesPerPurchase: number;
  @IsISO8601({ strict: true }) opensAt: string;
  @IsISO8601({ strict: true }) closesAt: string;
  @IsBoolean() resultsVisible: boolean;
}
export class CreateCandidateDto {
  @IsOptional() @IsUUID() photoImageId?: string | null;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) name: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) bio: string;
  @IsOptional() @IsString() @MaxLength(2048) photoUrl: string | null;
}
export class PollStatusDto {
  @IsIn(['PUBLISHED', 'CLOSED']) status: 'PUBLISHED' | 'CLOSED';
}
export class PurchaseDto {
  @IsUUID() pollId: string;
  @IsUUID() candidateId: string;
  @IsInt() @Min(1) @Max(100000) quantity: number;
  @Transform(trim) @IsEmail() @MaxLength(254) email: string;
}

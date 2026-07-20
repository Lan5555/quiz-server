/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  roomId!: string;

  @IsString()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];

  @IsOptional()
  @IsString()
  clientId?: string; // ✅ ADDED - For optimistic updates
}

export class JoinRoomDto {
  @IsUUID()
  roomId!: string;
}

export class ReadReceiptDto {
  @IsUUID()
  roomId!: string;
}

export class TypingDto {
  @IsUUID()
  roomId!: string;
}

export class CreateRoomDto {
  @IsString()
  name!: string;

  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => value.map((id: any) => String(id)))
  memberIds!: string[];
}

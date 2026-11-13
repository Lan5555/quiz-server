import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ok, VotingExceptionFilter } from '../common/voting';
import { VotingRateGuard } from '../common/voting-rate.guard';
import { VotingAuthService } from './voting-auth.service';

export class VotingLoginDto {
  @IsString() @MinLength(1) @MaxLength(512) password: string;
}

@Controller('votes/api/admin')
@UseFilters(VotingExceptionFilter)
@UseGuards(VotingRateGuard)
export class VotingAuthController {
  constructor(private readonly auth: VotingAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: VotingLoginDto) {
    return ok(await this.auth.login(body.password), 'Welcome back admin');
  }
}

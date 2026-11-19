import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Ip,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { GameAccountsService } from './game-accounts.service';
import { ProgressionService } from '../progression/progression.service';
import { GEAR, JOBS } from '../progression/catalog';
import type { Loadout } from '../progression/catalog';
import { GameCheckoutService } from '../payments/game-checkout.service';

class CredentialsDto {
  @Matches(/^[a-zA-Z0-9_]{3,24}$/)
  username!: string;

  @IsString()
  @Length(10, 128)
  password!: string;
}

class LoadoutDto implements Loadout {
  @IsIn(Object.keys(JOBS))
  job!: Loadout['job'];

  @IsIn(Object.keys(GEAR))
  weapon!: Loadout['weapon'];

  @IsIn(Object.keys(GEAR))
  armor!: Loadout['armor'];

  @Matches(/^[a-z0-9_-]{1,50}$/)
  item!: Loadout['item'];
}

class PurchaseDto {
  @IsUUID('4')
  requestId!: string;

  @Matches(/^[a-z0-9_-]{1,50}$/)
  product!: string;
}

class GameCheckoutDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @MaxLength(50)
  gearId!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

@Controller('game/api')
export class GameAccountController {
  private readonly logger = new Logger(GameAccountController.name);

  constructor(
    private readonly accounts: GameAccountsService,
    private readonly progression: ProgressionService,
    private readonly checkout: GameCheckoutService,
  ) {}

  @Post('auth/register')
  @Header('Cache-Control', 'no-store')
  register(@Body() body: CredentialsDto, @Ip() ip: string) {
    return this.accounts.authenticate(body.username, body.password, ip, true);
  }

  @Post('auth/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: CredentialsDto, @Ip() ip: string) {
    return this.accounts.authenticate(body.username, body.password, ip, false);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Headers('authorization') authorization?: string) {
    return this.accounts.logout(this.bearer(authorization));
  }

  @Get('catalog')
  catalog() {
    return this.progression.catalog();
  }

  @Get('profile')
  @Header('Cache-Control', 'no-store')
  async profile(@Headers('authorization') authorization?: string) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    try {
      return await this.progression.profile(id);
    } catch (error) {
      if (
        !(error instanceof QueryFailedError) ||
        error.driverError.code !== '42703'
      )
        throw error;
      this.logger.error(
        'Game profile query failed: SQLSTATE=42703 (undefined column)',
      );
      throw new ServiceUnavailableException(
        'The game database needs an update. Contact the game administrator.',
      );
    }
  }

  @Put('loadout')
  async loadout(
    @Body() body: LoadoutDto,
    @Headers('authorization') authorization?: string,
  ) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    return this.progression.saveLoadout(id, body);
  }

  @Post('purchases')
  @HttpCode(200)
  async purchase(
    @Body() body: PurchaseDto,
    @Headers('authorization') authorization?: string,
  ) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    return this.progression.purchase(id, body.requestId, body.product);
  }

  @Get('checkout/offers')
  @Header('Cache-Control', 'no-store')
  offers() {
    return this.checkout.offers();
  }

  @Get('checkout/orders')
  @Header('Cache-Control', 'no-store')
  async orders(@Headers('authorization') authorization?: string) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    return this.checkout.orders(id);
  }

  @Post('checkout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async startCheckout(
    @Body() body: GameCheckoutDto,
    @Headers('authorization') authorization?: string,
  ) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    return this.checkout.start(id, body.requestId, body.gearId, body.email);
  }

  @Post('checkout/:orderId/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verifyCheckout(
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const { id } = await this.accounts.requireSession(
      this.bearer(authorization),
    );
    return this.checkout.verify(id, orderId);
  }

  private bearer(header?: string) {
    const token = /^Bearer ([^ ]+)$/.exec(header ?? '')?.[1];
    if (!token)
      throw new UnauthorizedException('Sign in to your Embrace account.');
    return token;
  }
}

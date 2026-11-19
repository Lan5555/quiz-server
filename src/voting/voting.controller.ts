import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminRequest } from './auth/voting-auth.service';
import { VotingAdminGuard } from './auth/voting-auth.service';
import {
  CreateCandidateDto,
  CreatePollDto,
  PollStatusDto,
  PurchaseDto,
} from './common/voting.dto';
import { ok, VotingExceptionFilter } from './common/voting';
import { VotingRateGuard } from './common/voting-rate.guard';
import { PollsService } from './polls/polls.service';
import { CandidatesService } from './candidates/candidates.service';
import { PurchasesService } from './purchases/purchases.service';
import { VotingWebhooksService } from './payments/voting-webhooks.service';
import { GameCheckoutService } from '../game/payments/game-checkout.service';
@Controller('votes/api')
@UseFilters(VotingExceptionFilter)
@UseGuards(VotingRateGuard)
export class VotingController {
  constructor(
    private readonly polls: PollsService,
    private readonly candidates: CandidatesService,
    private readonly purchases: PurchasesService,
  ) {}
  @Get('polls') async list() {
    return ok(await this.polls.list());
  }
  @Get('polls/:slug') async detail(@Param('slug') slug: string) {
    return ok(await this.polls.detail(slug));
  }
  @Get('admin/polls') @UseGuards(VotingAdminGuard) async adminList() {
    return ok(await this.polls.list(true));
  }
  @Get('admin/polls/:id') @UseGuards(VotingAdminGuard) async adminDetail(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return ok(await this.polls.detail(id, true));
  }
  @Post('admin/polls') @UseGuards(VotingAdminGuard) async create(
    @Body() body: CreatePollDto,
    @Req() req: AdminRequest,
  ) {
    return ok(await this.polls.create(body, req.votingAdminId));
  }
  @Post('admin/polls/:id/candidates')
  @UseGuards(VotingAdminGuard)
  async candidate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCandidateDto,
    @Req() req: AdminRequest,
  ) {
    return ok(await this.candidates.create(id, body, req.votingAdminId));
  }
  @Post('admin/polls/:id/status') @UseGuards(VotingAdminGuard) async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PollStatusDto,
    @Req() req: AdminRequest,
  ) {
    return ok(await this.polls.status(id, body.status, req.votingAdminId));
  }
  @Post('purchases') @HttpCode(200) async purchase(
    @Headers('idempotency-key') key: string,
    @Body() body: PurchaseDto,
  ) {
    return ok(await this.purchases.start(key, body));
  }
  @Get('purchases/:id') async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-vote-receipt-token') token: string,
  ) {
    return ok(await this.purchases.receipt(id, token));
  }
}
@Controller('votes/api/webhooks')
@UseFilters(VotingExceptionFilter)
export class VotingWebhookController {
  constructor(
    private readonly webhooks: VotingWebhooksService,
    private readonly gameCheckout: GameCheckoutService,
  ) {}
  @Post('flutterwave')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('verif-hash') signature: string,
  ) {
    if (!(await this.gameCheckout.routeWebhook(req.rawBody, signature))) {
      await this.webhooks.accept(req.rawBody, signature);
    }
    return ok(null, 'Webhook queued');
  }
}

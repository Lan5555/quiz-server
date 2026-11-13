import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';

export const ok = (data: unknown, message = 'Success') => ({
  success: true,
  message,
  data,
});
export function fail(status: number, message: string, code?: string): never {
  throw new HttpException(
    { success: false, message, data: null, ...(code ? { code } : {}) },
    status,
  );
}
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
@Catch()
export class VotingExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const body =
      typeof response === 'object' && response
        ? (response as Record<string, unknown>)
        : {};
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        success: false,
        message:
          body.message ||
          (status === 503
            ? 'Voting service temporarily unavailable. Please retry the same request.'
            : 'Invalid request'),
        data: null,
        ...(body.code ? { code: body.code } : {}),
      });
  }
}
@Injectable()
export class VotingConfig {
  private readonly logger = new Logger(VotingConfig.name);
  constructor(private readonly config: ConfigService) {}
  get(name: string) {
    return this.config.get<string>(name) || '';
  }
  required(name: string) {
    const value = this.get(name);
    if (!value) {
      this.logger.error(`Missing required backend setting: ${name}`);
      fail(503, 'Voting service is not configured');
    }
    return value;
  }
  maximum() {
    const n = Number(this.get('VOTING_MAX_AMOUNT_MINOR') || '100000000');
    if (!Number.isSafeInteger(n) || n < 1 || n > 100000000)
      fail(503, 'Invalid voting amount configuration');
    return n;
  }
  frontend() {
    const configuredOrigin = this.required('VOTING_FRONTEND_ORIGIN');
    let url: URL;
    try {
      url = new URL(configuredOrigin);
    } catch {
      fail(503, 'Invalid frontend origin configuration');
    }
    const localDevelopment =
      this.get('NODE_ENV') !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localDevelopment) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      fail(503, 'Invalid frontend origin configuration');
    return url.origin;
  }
  checkoutSeconds() {
    const n = Number(this.get('VOTING_CHECKOUT_SECONDS') || '1800');
    if (!Number.isInteger(n) || n < 60 || n > 86400)
      fail(503, 'Invalid checkout window configuration');
    return n;
  }
  enabled() {
    if (this.get('VOTING_PAYMENTS_ENABLED') !== 'true')
      fail(503, 'Vote payments are not enabled');
    this.frontend();
    this.maximum();
    this.checkoutSeconds();
    this.required('FLUTTERWAVE_SECRET_KEY');
    this.required('FLUTTERWAVE_SECRET_HASH');
    this.required('VOTING_RECEIPT_KEY');
    if (!['test', 'live'].includes(this.required('VOTING_PROVIDER_MODE')))
      fail(503, 'Invalid provider mode configuration');
    const key = this.required('FLUTTERWAVE_SECRET_KEY');
    const mode = key.startsWith('FLWSECK_TEST-')
      ? 'test'
      : key.startsWith('FLWSECK-')
        ? 'live'
        : null;
    if (mode !== this.get('VOTING_PROVIDER_MODE'))
      fail(503, 'Flutterwave key mode is not configured correctly');
  }
}

import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { flutterwaveFailureCode } from '../payments/flutterwave.service';
import { ReceiptTokenDecryptionError } from './receipt-token.service';

export function checkoutFailureCode(error: unknown): string {
  if (error instanceof ReceiptTokenDecryptionError)
    return 'RECEIPT_DECRYPTION_FAILED';
  if (error instanceof QueryFailedError) {
    const driver: unknown = error.driverError;
    const code =
      driver && typeof driver === 'object' && 'code' in driver
        ? driver.code
        : undefined;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
      return `DATABASE_SQLSTATE_${code}`;
    return 'DATABASE_WRITE_FAILED';
  }
  const provider = flutterwaveFailureCode(error);
  if (provider !== 'UNKNOWN_PROVIDER_ERROR') return provider;
  if (error instanceof HttpException) {
    if (error.message === 'Receipt encryption is not configured')
      return 'RECEIPT_KEY_INVALID';
    if (error.message === 'Voting service is not configured')
      return 'CONFIGURATION_MISSING';
    if (error.message === 'Invalid frontend origin configuration')
      return 'FRONTEND_ORIGIN_INVALID';
    return `LOCAL_HTTP_${error.getStatus()}`;
  }
  if (error instanceof TypeError) return 'LOCAL_TYPE_ERROR';
  if (error instanceof SyntaxError) return 'LOCAL_SYNTAX_ERROR';
  if (error instanceof RangeError) return 'LOCAL_RANGE_ERROR';
  return provider;
}

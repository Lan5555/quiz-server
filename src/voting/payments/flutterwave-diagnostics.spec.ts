import axios, { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { VotingConfig } from '../common/voting';
import {
  FlutterwaveProviderError,
  FlutterwaveService,
  parseFlutterwaveResponse,
  flutterwaveFailureCode,
} from './flutterwave.service';
import { QueryFailedError } from 'typeorm';
import { checkoutFailureCode } from '../purchases/checkout-diagnostics';
import {
  ReceiptTokenService,
  ReceiptTokenDecryptionError,
} from '../purchases/receipt-token.service';

describe('Flutterwave safe diagnostics', () => {
  function checkoutProvider(mode: string) {
    const settings = new ConfigService({ VOTING_PROVIDER_MODE: mode });
    settings.skipProcessEnv = true;
    return new FlutterwaveService(new VotingConfig(settings));
  }
  it('accepts the documented Flutterwave sandbox checkout host only in test mode', () => {
    const sandbox =
      'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture';
    expect(checkoutProvider('test').checkoutUrl(sandbox)).toBe(sandbox);
    expect(
      checkoutProvider('test').checkoutUrl(
        'https://checkout.flutterwave.com/v3/hosted/pay/fixture',
      ),
    ).toBe('https://checkout.flutterwave.com/v3/hosted/pay/fixture');
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() => checkoutProvider('live').checkoutUrl(sandbox)).toThrow();
    } finally {
      log.mockRestore();
    }
  });
  it.each([
    'http://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture',
    'https://checkout-v2.dev-flutterwave.com.evil.example/v3/hosted/pay/fixture',
    'https://checkout-v2.dev-flutterwave.com:444/v3/hosted/pay/fixture',
    'https://user:private@checkout-v2.dev-flutterwave.com/v3/hosted/pay/private-token',
    'https://checkout.flutterwave.com@evil.example/private-token',
  ])(
    'rejects unsafe sandbox redirects without logging their token: %s',
    (value) => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        expect(() => checkoutProvider('test').checkoutUrl(value)).toThrow();
        expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
        expect(JSON.stringify(log.mock.calls)).not.toContain('user:private');
      } finally {
        log.mockRestore();
      }
    },
  );
  it('preserves an HTTP rejection when the provider responds with HTML instead of JSON', async () => {
    const settings = new ConfigService({
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-unit-fixture-X',
      VOTING_PROVIDER_MODE: 'test',
    });
    settings.skipProcessEnv = true;
    const provider = new FlutterwaveService(new VotingConfig(settings));
    const adapter = axios.defaults.adapter;
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    axios.defaults.adapter = (config) =>
      Promise.reject(
        new AxiosError(
          'private-provider-error',
          AxiosError.ERR_BAD_REQUEST,
          config,
          undefined,
          {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'text/html' },
            data: '<html>private-provider-payload</html>',
            config,
          },
        ),
      );
    try {
      await expect(provider.verify('fixture-reference')).rejects.toMatchObject({
        diagnostic: 'HTTP_401',
      });
      expect(log).toHaveBeenCalledWith(
        'Flutterwave VERIFY_PAYMENT failed: HTTP_401',
      );
    } finally {
      axios.defaults.adapter = adapter;
      log.mockRestore();
    }
  });
  it('classifies non-JSON bodies, preserves large IDs, and recognizes TLS errors safely', () => {
    expect(parseFlutterwaveResponse('<html>private-payload</html>')).toEqual({
      status: '__INVALID_JSON__',
      data: null,
    });
    expect(parseFlutterwaveResponse('{"id":9007199254740993}')).toEqual({
      id: '9007199254740993',
    });
    expect(
      flutterwaveFailureCode(
        new AxiosError('private-message', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
      ),
    ).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });
  it('reports database SQLSTATE without exposing SQL, parameters or driver text', () => {
    const error = new QueryFailedError(
      'private SQL',
      ['private parameter'],
      Object.assign(new Error('private driver details'), { code: '23505' }),
    );
    expect(checkoutFailureCode(error)).toBe('DATABASE_SQLSTATE_23505');
  });
  it('identifies a stored receipt encrypted under a different key', () => {
    const keyConfig = (key: string) => {
      const s = new ConfigService({ VOTING_RECEIPT_KEY: key });
      s.skipProcessEnv = true;
      return new VotingConfig(s);
    };
    const first = new ReceiptTokenService(keyConfig('ab'.repeat(32)));
    const second = new ReceiptTokenService(keyConfig('cd'.repeat(32)));
    const receipt = first.create('fixture-purchase');
    let error: unknown;
    try {
      second.decrypt('fixture-purchase', receipt.encrypted);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReceiptTokenDecryptionError);
    expect(checkoutFailureCode(error)).toBe('RECEIPT_DECRYPTION_FAILED');
  });
  it('reports HTTP status without logging provider bodies, credentials or request data', async () => {
    const settings = new ConfigService({
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-only-a-unit-fixture-X',
      VOTING_PROVIDER_MODE: 'test',
    });
    settings.skipProcessEnv = true;
    const provider = new FlutterwaveService(new VotingConfig(settings));
    const api = jest.spyOn(axios, 'request').mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: 'sensitive-provider-body' } },
      config: { headers: { Authorization: 'private-test-header' } },
    });
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(provider.verify('test-reference')).rejects.toBeInstanceOf(
        FlutterwaveProviderError,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'Flutterwave VERIFY_PAYMENT failed: HTTP_401',
      );
    } finally {
      api.mockRestore();
      log.mockRestore();
    }
  });
});

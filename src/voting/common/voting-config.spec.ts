import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VotingConfig } from './voting';

describe('VotingConfig diagnostics', () => {
  function frontend(origin: string, environment = 'development') {
    const settings = new ConfigService({
      VOTING_FRONTEND_ORIGIN: origin,
      NODE_ENV: environment,
    });
    settings.skipProcessEnv = true;
    return new VotingConfig(settings).frontend();
  }
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('accepts a local HTTP frontend in development: %s', (origin) => {
    expect(frontend(origin)).toBe(origin);
  });
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('requires HTTPS for production even on loopback: %s', (origin) => {
    expect(() => frontend(origin, 'production')).toThrow(
      'Invalid frontend origin configuration',
    );
  });
  it('accepts an HTTPS frontend in production and normalizes a trailing slash', () => {
    expect(frontend('https://votes.example.test/', 'production')).toBe(
      'https://votes.example.test',
    );
  });
  it.each([
    'http://votes.example.test',
    'http://localhost.evil.example:3000',
    'https://user:pass@votes.example.test',
    'http://localhost:3000/pages/votes',
    'http://localhost:3000/?poll=1',
    'http://localhost:3000/#votes',
    'not-a-url',
  ])('rejects an invalid configured origin: %s', (origin) => {
    expect(() => frontend(origin)).toThrow(
      'Invalid frontend origin configuration',
    );
  });
  it('logs only the missing setting name and keeps the public response generic', () => {
    const settings = new ConfigService({
      OTHER_SETTING: 'test-only-sensitive-value',
    });
    settings.skipProcessEnv = true;
    const config = new VotingConfig(settings);
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      let error: unknown;
      try {
        config.required('VOTING_RECEIPT_KEY');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toEqual({
        success: false,
        message: 'Voting service is not configured',
        data: null,
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'Missing required backend setting: VOTING_RECEIPT_KEY',
      );
    } finally {
      log.mockRestore();
    }
  });
});

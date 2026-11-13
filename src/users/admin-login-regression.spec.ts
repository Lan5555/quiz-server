// These aliases are used by unrelated UsersService methods. No database,
// mail client, environment configuration or voting service is initialized here.
jest.mock(
  'src/cron-job/cron-job.service',
  () => ({ CronJobService: class {} }),
  { virtual: true },
);
jest.mock(
  'src/email-service/email-service.service',
  () => ({ EmailServiceService: class {} }),
  { virtual: true },
);
jest.mock('src/misc/entities/misc.entity', () => ({ Misc: class {} }), {
  virtual: true,
});

import { UsersService } from './users.service';

describe('existing portal admin login', () => {
  it('handles login without voting configuration, voting tables or a voting session', async () => {
    const service = new UsersService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    await expect(
      service.logInAdmin({
        password: 'deliberately-invalid-regression-test-input',
      }),
    ).resolves.toMatchObject({ success: false, data: null });
  });
});

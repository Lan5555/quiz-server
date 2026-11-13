import { HttpException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fail, VotingConfig } from '../common/voting';
export class ReceiptTokenDecryptionError extends HttpException {
  constructor() {
    super(
      {
        success: false,
        message:
          'Checkout receipt access is temporarily unavailable. Keep this attempt and contact support.',
        data: null,
      },
      503,
    );
  }
}
@Injectable()
export class ReceiptTokenService {
  constructor(private readonly config: VotingConfig) {}
  private key() {
    const value = this.config.required('VOTING_RECEIPT_KEY');
    if (!/^[a-f0-9]{64}$/.test(value))
      fail(503, 'Receipt encryption is not configured');
    return Buffer.from(value, 'hex');
  }
  create(id: string) {
    const token = randomBytes(32).toString('base64url');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      token,
      encrypted: [iv, cipher.getAuthTag(), ciphertext]
        .map((b) => b.toString('base64url'))
        .join('.'),
    };
  }
  decrypt(id: string, value: string) {
    const key = this.key();
    try {
      const [iv, tag, data] = value
        .split('.')
        .map((v) => Buffer.from(v, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(id));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new ReceiptTokenDecryptionError();
    }
  }
}

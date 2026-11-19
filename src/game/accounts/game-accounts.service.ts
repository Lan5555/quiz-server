import {
  ConflictException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';

const deriveKey = promisify(scrypt);
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export interface GameIdentity {
  id: string;
  username: string;
  moderator: boolean;
}

@Injectable()
export class GameAccountsService {
  // Bounds expensive password hashing and keeps the limiter bounded on one server.
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(private readonly db: DataSource) {}

  async authenticate(
    username: string,
    password: string,
    ip: string,
    register: boolean,
  ) {
    this.limit(ip);
    username = username.toLowerCase();
    const [account] = await this.db.query<
      {
        id: string;
        password_salt: string;
        password_digest: string;
      }[]
    >(
      'SELECT id, password_salt, password_digest FROM game_accounts WHERE username = $1',
      [username],
    );
    const salt =
      register || !account
        ? randomBytes(16).toString('hex')
        : account.password_salt;
    const digest = (await deriveKey(password, salt, 64)) as Buffer;
    const token = randomBytes(32).toString('hex');
    const id = register ? randomUUID() : account?.id;
    if (
      !register &&
      (!account ||
        !timingSafeEqual(digest, Buffer.from(account.password_digest, 'hex')))
    ) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    await this.db.transaction(async (tx) => {
      if (register) {
        const inserted = await tx.query<unknown[]>(
          'INSERT INTO game_accounts(id,username,password_salt,password_digest) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING RETURNING id',
          [id, username, salt, digest.toString('hex')],
        );
        if (!inserted.length)
          throw new ConflictException('That username is taken.');
      }
      await tx.query(
        'DELETE FROM game_sessions WHERE account_id=$1 AND expires_at<=now()',
        [id],
      );
      await tx.query(
        "INSERT INTO game_sessions(token_hash, account_id, expires_at) VALUES ($1,$2,now()+interval '7 days')",
        [tokenHash(token), id],
      );
    });
    return { id, username, token };
  }

  async requireSession(token: unknown): Promise<GameIdentity> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new UnauthorizedException('Sign in to your Embrace account.');
    }
    const [account] = await this.db.query<GameIdentity[]>(
      'SELECT a.id, a.username, a.moderator FROM game_accounts a JOIN game_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [tokenHash(token)],
    );
    if (!account)
      throw new UnauthorizedException(
        'Your game session has expired. Sign in again.',
      );
    return account;
  }

  async logout(token: string) {
    await this.requireSession(token);
    await this.db.query('DELETE FROM game_sessions WHERE token_hash=$1', [
      tokenHash(token),
    ]);
  }

  private limit(ip: string) {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (attempt && attempt.until > now) {
      if (attempt.count >= 8)
        throw new HttpException(
          'Too many sign-in attempts. Try again shortly.',
          429,
        );
      attempt.count++;
      return;
    }
    if (this.attempts.size >= 10000) {
      for (const [key, value] of this.attempts) {
        if (value.until <= now) this.attempts.delete(key);
      }
      if (this.attempts.size >= 10000)
        throw new HttpException('Sign-in is busy. Try again shortly.', 429);
    }
    this.attempts.set(ip, { count: 1, until: now + 60_000 });
  }
}

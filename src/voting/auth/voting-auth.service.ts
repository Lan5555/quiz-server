import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { equal, fail, hash, VotingConfig } from '../common/voting';
const scrypt = promisify(scryptCallback);
@Injectable()
export class VotingAuthService {
  private readonly logger = new Logger(VotingAuthService.name);
  constructor(
    private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly config: VotingConfig,
  ) {}
  async login(password: unknown) {
    if (typeof password !== 'string' || password.length > 512)
      this.rejectLogin('INVALID_LOGIN_BODY');
    const admins = await this.db.query<
      {
        id: string;
        name: string;
        email: string;
        enabled: boolean;
        can_manage_votes: boolean;
      }[]
    >(
      `SELECT id,name,email,enabled,can_manage_votes FROM voting_admins WHERE lower(btrim(email))=$1 LIMIT 2`,
      [this.config.required('VOTING_ADMIN_EMAIL').trim().toLowerCase()],
    );
    const admin = admins[0];
    const [salt, digest] = this.config
      .required('VOTING_ADMIN_PASSWORD_HASH')
      .split(':');
    if (!salt || !/^[a-f0-9]{128}$/.test(digest || ''))
      fail(503, 'Admin credentials are not configured');
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const passwordMatches = equal(actual.toString('hex'), digest);
    if (!admin) this.rejectLogin('ADMIN_NOT_PROVISIONED');
    if (admins.length > 1) this.rejectLogin('AMBIGUOUS_ADMIN_EMAIL');
    if (!admin.enabled) this.rejectLogin('ADMIN_DISABLED');
    if (!admin.can_manage_votes) this.rejectLogin('VOTING_PERMISSION_MISSING');
    if (!passwordMatches) this.rejectLogin('PASSWORD_MISMATCH');
    const id = randomUUID();
    const token = await this.jwt.signAsync(
      { sub: admin.id, role: 'voting-admin', jti: id },
      {
        secret: this.config.required('VOTING_ADMIN_JWT_SECRET'),
        algorithm: 'HS256',
        audience: 'voting-admin',
        issuer: 'quiz-server',
        expiresIn: '1h',
      },
    );
    await this.db.query(
      `INSERT INTO voting_admin_sessions(id,admin_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [id, admin.id, hash(token)],
    );
    return { name: admin.name, email: admin.email, level: 3, token };
  }
  private rejectLogin(reason: string): never {
    // Operator-only diagnostics. Never log submitted credentials, hashes, email or tokens.
    this.logger.warn(`Admin login rejected: ${reason}`);
    fail(401, 'Invalid admin credentials');
  }
  async authorize(token: string) {
    const secret = this.config.required('VOTING_ADMIN_JWT_SECRET');
    let claims: { sub: string; role: string; jti: string };
    try {
      claims = await this.jwt.verifyAsync(token, {
        secret,
        algorithms: ['HS256'],
        audience: 'voting-admin',
        issuer: 'quiz-server',
      });
    } catch {
      fail(401, 'Admin session expired or invalid');
    }
    if (claims.role !== 'voting-admin' || !claims.jti || !claims.sub)
      fail(403, 'Admin access required');
    const [session] = await this.db.query<{ id: string }[]>(
      `SELECT a.id FROM voting_admin_sessions s JOIN voting_admins a ON a.id=s.admin_id WHERE s.id=$1 AND s.admin_id=$2 AND s.token_hash=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.enabled AND a.can_manage_votes`,
      [claims.jti, claims.sub, hash(token)],
    );
    if (!session) fail(403, 'Admin session revoked or permission removed');
    return session.id;
  }
}
export type AdminRequest = Request & { votingAdminId: string };
@Injectable()
export class VotingAdminGuard implements CanActivate {
  constructor(private readonly auth: VotingAuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const match = /^Bearer ([^ ]+)$/.exec(req.headers.authorization || '');
    if (!match) fail(401, 'Admin authentication required');
    req.votingAdminId = await this.auth.authorize(match[1]);
    return true;
  }
}

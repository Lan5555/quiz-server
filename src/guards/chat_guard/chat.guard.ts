/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

/**
 * Verifies the JWT sent by the client during the socket.io handshake and
 * attaches { userId, name } to socket.data so every handler can trust it.
 *
 * Client side sends the token like:
 *   io(url, { auth: { token: accessToken } })
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token =
      client.handshake.auth?.token ??
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) throw new UnauthorizedException('Missing auth token');

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.data.userId = payload.sub;
      client.data.name = payload.name;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

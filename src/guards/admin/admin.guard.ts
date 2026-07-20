import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly ADMIN_EMAIL = 'okekejohnson24@gmail.com';

  canActivate(context: ExecutionContext): boolean {
    const type = context.getType<'http' | 'ws'>();

    let user:
      | {
          sub: number;
          email: string;
          name: string;
        }
      | undefined;

    if (type === 'http') {
      const request = context.switchToHttp().getRequest<{
        user?: {
          sub: number;
          email: string;
          name: string;
        };
      }>();

      user = request.user;
    } else if (type === 'ws') {
      const client = context.switchToWs().getClient<{
        user?: {
          sub: number;
          email: string;
          name: string;
        };
      }>();

      user = client.user;
    }

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (user.email !== this.ADMIN_EMAIL) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction, Express } from 'express';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const origins = (config.get<string>('VOTING_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .concat(
      process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000'],
    );
  const votingPath = (path: string) => path.startsWith('/votes/api');
  const hops = Number(config.get<string>('VOTING_TRUST_PROXY_HOPS') || '0');
  if (Number.isInteger(hops) && hops > 0)
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', hops);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (votingPath(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
      if (req.headers.origin && !origins.includes(req.headers.origin)) {
        res.status(403).json({
          success: false,
          message: 'Frontend origin is not allowed',
          data: null,
        });
        return;
      }
    }
    next();
  });
  const cors: CorsOptionsDelegate<Request> = (req, callback) =>
    callback(
      null,
      votingPath(req.path)
        ? {
            origin: origins,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: [
              'Authorization',
              'Content-Type',
              'Idempotency-Key',
              'X-Vote-Receipt-Token',
            ],
          }
        : { origin: true },
    );
  app.enableCors(cors);

  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove extra fields
      forbidNonWhitelisted: true, // throw error on extra fields
      transform: true, // automatically transform types
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();

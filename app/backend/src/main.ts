import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { appConfig } from './config/app-config.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  // Доверие прокси — только явно из конфига (дефолт false: слушаем напрямую).
  // Слепое trust proxy=true запрещено: см. parseTrustProxy.
  if (appConfig.app.trustProxy !== false) {
    const server = app.getHttpAdapter().getInstance() as {
      set(key: string, value: unknown): unknown;
    };
    server.set('trust proxy', appConfig.app.trustProxy);
  }
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: appConfig.cors.origins, credentials: true });

  await app.listen(appConfig.app.port);
}
void bootstrap();

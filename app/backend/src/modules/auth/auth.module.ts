import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './guards/jwt.strategy';
import { JwtTokenService } from './jwt-token.service';
import { AUTH_CONFIG } from './auth.config';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';

@Module({
  imports: [
    UsersModule,
    SessionsModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtTokenService,
    {
      provide: AUTH_CONFIG,
      // Без двойной загрузки ключей: AUTH_CONFIG — это поле единого AppConfig.
      useFactory: (app: AppConfig) => app.jwt,
      inject: [APP_CONFIG],
    },
  ],
})
export class AuthModule {}

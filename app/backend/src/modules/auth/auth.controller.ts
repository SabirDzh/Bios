import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { User } from '../../common/decorators/user.decorator';
import { AuthService } from './auth.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshTokenCookie } from './decorators/refresh-token.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { clearPairCookies, setPairCookies } from './auth-cookies';

// Брутфорс-защита: 10 попыток в минуту на точку (глобально 120/min).
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body() authLoginDto: AuthLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.service.login(authLoginDto);
    setPairCookies(res, this.config, pair);
  }

  @Post('refresh')
  @Throttle(AUTH_THROTTLE)
  async refreshTokens(
    @RefreshTokenCookie() refreshToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.service.refresh(refreshToken);
    setPairCookies(res, this.config, pair);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(
    @User() user: JwtUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(user);
    clearPairCookies(res, this.config);
  }
}

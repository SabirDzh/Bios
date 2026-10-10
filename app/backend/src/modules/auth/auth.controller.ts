import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ThrottleProfile } from '../../common/throttle/throttle-profile.decorator';
import type { Response } from 'express';
import { User } from '../../common/decorators/user.decorator';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshTokenCookie } from './decorators/refresh-token.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import {
  clearPairCookies,
  cookieFlagsFrom,
  setPairCookies,
} from './auth-cookies';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly usersService: UsersService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  @Post('register')
  @ThrottleProfile('authStrict')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('login')
  @HttpCode(200)
  @ThrottleProfile('authStrict')
  async login(
    @Body() authLoginDto: AuthLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.service.login(authLoginDto);
    setPairCookies(res, cookieFlagsFrom(this.appConfig), pair);
  }

  @Post('refresh')
  @ThrottleProfile('authStrict')
  async refreshTokens(
    @RefreshTokenCookie() refreshToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.service.refresh(refreshToken);
    setPairCookies(res, cookieFlagsFrom(this.appConfig), pair);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(
    @User() user: JwtUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(user);
    clearPairCookies(res, cookieFlagsFrom(this.appConfig));
  }

  /** Алиас logout по спеку (`POST auth/revoke` — отмена сессии). */
  @Post('revoke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async revoke(
    @User() user: JwtUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(user);
    clearPairCookies(res, cookieFlagsFrom(this.appConfig));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@User() user: JwtUserPayload) {
    return user;
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Patch,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { ThrottleProfile } from '../../common/throttle/throttle-profile.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { clearPairCookies, cookieFlagsFrom } from '../auth/auth-cookies';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { UsersService } from './users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestRecoveryDto } from './dto/request-recovery.dto';
import { RecoveryPasswordDto } from './dto/recovery-password.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';

@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ThrottleProfile('authStrict')
  async changePassword(
    @User() user: JwtUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.service.changePassword(user.userId, changePasswordDto);
    clearPairCookies(res, cookieFlagsFrom(this.appConfig));
  }

  @Post('request-recovery')
  @HttpCode(200)
  @ThrottleProfile('recovery')
  async requestRecovery(@Body() requestRecoveryDto: RequestRecoveryDto) {
    return await this.service.requestRecovery(requestRecoveryDto.email);
  }

  // Токены confirm/recovery принимаются только в body (S3):
  // в URL они оседали бы в access-логах, истории браузера и прокси.
  @Patch('confirm')
  @ThrottleProfile('recovery')
  async confirm(@Body() confirmDto: ConfirmDto) {
    return await this.service.confirm(confirmDto.confirmationId);
  }

  @Patch('recovery')
  @ThrottleProfile('recovery')
  async recovery(@Body() recoveryPasswordDto: RecoveryPasswordDto) {
    return await this.service.recoveryPassword(
      recoveryPasswordDto.recoveryId,
      recoveryPasswordDto,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@User() user: JwtUserPayload) {
    return user;
  }
}

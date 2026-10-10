import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Patch,
  Res,
  HttpCode,
  Param,
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
import { FindRecoveryByIdDto } from './dto/find-recovery.dto';
import { RecoveryPasswordDto } from './dto/recovery-password.dto';
import { FindConfirmationByIdDto } from './dto/find-confirmation.dto';
import { TokenType } from '@prisma/client';
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

  @Patch('confirm/:confirmationId')
  async confirm(@Param() findConfirmationByIdDto: FindConfirmationByIdDto) {
    return await this.service.confirm(findConfirmationByIdDto.confirmationId);
  }

  @Get('recovery/:recoveryId')
  async findRecoveryToken(@Param() findRecoveryByIdDto: FindRecoveryByIdDto) {
    return await this.service.findTokenById(
      findRecoveryByIdDto.recoveryId,
      TokenType.RECOVERY,
    );
  }

  @Patch('recovery/:recoveryId')
  async recovery(
    @Param() findRecoveryByIdDto: FindRecoveryByIdDto,
    @Body() recoveryPasswordDto: RecoveryPasswordDto,
  ) {
    return await this.service.recoveryPassword(
      findRecoveryByIdDto.recoveryId,
      recoveryPasswordDto,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@User() user: JwtUserPayload) {
    return user;
  }
}

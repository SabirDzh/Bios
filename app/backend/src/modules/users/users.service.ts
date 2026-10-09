import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import * as argon2 from 'argon2';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { TokensService } from '../tokens/tokens.service';
import { TokenType, User } from '@prisma/client';
import { RecoveryPasswordDto } from './dto/recovery-password.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private tokensService: TokensService,
  ) { }

  async create(createUserDto: CreateUserDto) {
    // Defense in depth: DTO уже lowercas'ит, но нормализуем и тут
    // (сервис могут вызвать в обход ValidationPipe).
    const data = {
      username: createUserDto.username.trim().toLowerCase(),
      email: createUserDto.email.trim().toLowerCase(),
      password: await argon2.hash(createUserDto.password),
    };
    let user: User;
    try {
      user = await this.prisma.user.create({ data });
    } catch {
      throw new BadRequestException();
    }
    const token = await this.tokensService.create(user.id, TokenType.CONFIRM);
    this.sendConfirmationMail(user.email, token.id);

    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  async changePassword(id: string, changePasswordDto: ChangePasswordDto) {
    const { password, newPassword } = changePasswordDto;
    const user = await this.findById(id);

    const passwordMatches = await this.validateHash(password, user.password);
    if (!passwordMatches) throw new ForbiddenException();
    const hashedPassword = await argon2.hash(newPassword);

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword, refreshToken: null },
    });

    if (!updatedUser) throw new BadRequestException();

    const { password: _p, refreshToken: _r, ...updatedUserSafe } = updatedUser;

    return updatedUserSafe;
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();

    return user;
  }

  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) throw new NotFoundException();

    return user;
  }

  async setRefreshToken(id: string, refreshToken: string | null) {
    // Hash the token to prevent user impersonation in a possible database leak
    if (refreshToken) refreshToken = await argon2.hash(refreshToken);
    const user = await this.prisma.user.update({
      where: { id },
      data: { refreshToken },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async findTokenById(recoveryId: string, type: TokenType) {
    const token = await this.tokensService.findOne(recoveryId);
    if (!token || token.type !== type) throw new NotFoundException();

    return token;
  }

  async requestRecovery(email: string) {
    const user = await this.findByEmail(email);
    const token = await this.tokensService.create(user.id, TokenType.RECOVERY);

    this.sendRecoveryMail(user.email, token.id);
    return {
      message: 'Recovery email have been send',
    };
  }

  async recoveryPassword(
    recoveryId: string,
    recoveryPasswordDto: RecoveryPasswordDto,
  ) {
    const { password, confirmPassword } = recoveryPasswordDto;

    if (password !== confirmPassword) throw new BadRequestException();

    const token = await this.findTokenById(recoveryId, TokenType.RECOVERY);
    const user = await this.findById(token.userId);
    const hashedPassword = await argon2.hash(password);

    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
        },
      }),
      this.tokensService.remove(recoveryId),
    ]);

    return { message: 'Password recovery successfully.' };
  }

  async confirm(confirmationId: string) {
    const token = await this.findTokenById(confirmationId, TokenType.CONFIRM);
    const user = await this.findById(token.userId);
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          confirmed: true,
        },
      }),
      this.tokensService.remove(confirmationId),
    ]);
    return { message: 'User confirmed successfully.' };
  }

  private async sendConfirmationMail(email: string, tokenId: string) { }

  private async sendRecoveryMail(email: string, tokenId: string) { }

  async validateHash(content: string, hash: string) {
    try {
      return await argon2.verify(hash, content);
    } catch {
      return false;
    }
  }
}

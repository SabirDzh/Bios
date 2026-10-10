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
import { canonicalizeEmail } from '../../common/email/canonical-email';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokenType, RefreshSessionStatus, User } from '@prisma/client';
import { RecoveryPasswordDto } from './dto/recovery-password.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private tokensService: TokensService,
    private sessionsService: SessionsService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // Defense in depth: DTO уже lowercas'ит, но нормализуем и тут
    // (сервис могут вызвать в обход ValidationPipe).
    // canonicalEmail душит алиасы (точки/плюс-теги Gmail и др.): дубль
    // упирается в @unique, гонки исключены.
    const email = createUserDto.email.trim().toLowerCase();
    const data = {
      username: createUserDto.username.trim().toLowerCase(),
      email,
      canonicalEmail: canonicalizeEmail(email),
      password: await argon2.hash(createUserDto.password),
    };
    let user: User;
    try {
      user = await this.prisma.user.create({ data });
    } catch {
      throw new BadRequestException();
    }
    const token = await this.tokensService.create(user.id, TokenType.CONFIRM);
    await this.sendConfirmationMail(user.email, token.id);

    const { password: _password, ...userWithoutPassword } = user;
    void _password;

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
      data: { password: hashedPassword },
    });

    if (!updatedUser) throw new BadRequestException();

    // Смена пароля отзывает все сессии пользователя.
    await this.sessionsService.revokeAllForUser(id);

    const { password: _oldPassword, ...updatedUserSafe } = updatedUser;
    void _oldPassword;

    return updatedUserSafe;
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();

    return user;
  }

  async findByEmail(email: string) {
    // Поиск по канону: login/recovery работают с любой алиасной формой
    // (`John.Doe+spam@gmail.com` находит `johndoe@gmail.com`).
    const user = await this.prisma.user.findUnique({
      where: { canonicalEmail: canonicalizeEmail(email) },
    });
    if (!user) throw new NotFoundException();

    return user;
  }

  async findTokenById(recoveryId: string, type: TokenType) {
    const token = await this.tokensService.findOne(recoveryId);
    if (!token || token.type !== type) throw new NotFoundException();
    if (token.expiresAt <= new Date()) {
      // Просроченный одноразовый токен удаляем и отвечаем как на несуществующий.
      await this.tokensService.remove(recoveryId).catch(() => undefined);
      throw new NotFoundException();
    }

    return token;
  }

  async requestRecovery(email: string) {
    try {
      const user = await this.findByEmail(email);
      const token = await this.tokensService.create(
        user.id,
        TokenType.RECOVERY,
      );

      await this.sendRecoveryMail(user.email, token.id);
    } catch {
      // Не раскрываем, существует ли email: ответ всегда одинаковый.
    }
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

    // S4: delete-first в транзакции — побеждает ровно один конкурент.
    // Проигравший видит 0 удалённых строк → 404, повторное использование закрыто.
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.token.deleteMany({ where: { id: recoveryId } });
      if (deleted.count !== 1) throw new NotFoundException();
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
      // Восстановление пароля отзывает все сессии пользователя.
      await tx.refreshSession.updateMany({
        where: { userId: user.id, status: RefreshSessionStatus.ACTIVE },
        data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
      });
    });

    return { message: 'Password recovery successfully.' };
  }

  async confirm(confirmationId: string) {
    const token = await this.findTokenById(confirmationId, TokenType.CONFIRM);
    const user = await this.findById(token.userId);

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.token.deleteMany({
        where: { id: confirmationId },
      });
      if (deleted.count !== 1) throw new NotFoundException();
      await tx.user.update({
        where: { id: user.id },
        data: { confirmed: true },
      });
    });
    return { message: 'User confirmed successfully.' };
  }

  private async sendConfirmationMail(email: string, tokenId: string) {}

  private async sendRecoveryMail(email: string, tokenId: string) {}

  async validateHash(content: string, hash: string) {
    try {
      return await argon2.verify(hash, content);
    } catch {
      return false;
    }
  }
}

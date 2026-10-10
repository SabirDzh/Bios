import { Inject, Injectable, Optional } from '@nestjs/common';
import { TokenType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { getAppConfig } from '../../config/app-config.module';

@Injectable()
export class TokensService {
  private readonly cfg: AppConfig;

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.cfg = config ?? getAppConfig();
  }

  private ttlSec(type: TokenType): number {
    return type === TokenType.CONFIRM
      ? this.cfg.tokens.confirmTtlSec
      : this.cfg.tokens.recoveryTtlSec;
  }

  async create(userId: string, type: TokenType) {
    return await this.prisma.token.create({
      data: {
        userId,
        type,
        expiresAt: new Date(Date.now() + this.ttlSec(type) * 1000),
      },
    });
  }

  async findOne(id: string) {
    return await this.prisma.token.findUnique({
      where: { id },
    });
  }

  async remove(id: string) {
    return await this.prisma.token.delete({ where: { id } });
  }

  async removeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.token.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  }
}

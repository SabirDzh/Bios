import { Injectable } from '@nestjs/common';
import { TokenType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

/** TTL одноразовых токенов: подтверждение почты — 24ч, восстановление — 1ч. */
const TOKEN_TTL_MS: Record<TokenType, number> = {
  [TokenType.CONFIRM]: 24 * 60 * 60 * 1000,
  [TokenType.RECOVERY]: 60 * 60 * 1000,
};

@Injectable()
export class TokensService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, type: TokenType) {
    return await this.prisma.token.create({
      data: {
        userId,
        type,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
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

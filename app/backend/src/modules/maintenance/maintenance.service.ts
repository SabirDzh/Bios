import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RefreshSessionStatus } from '@prisma/client';

/** Неактивные сессии старше 30 дней удаляем (аудит-история короткая, мусора нет). */
const STALE_SESSION_DAYS = 30;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<{ tokens: number; sessions: number }> {
    const now = new Date();
    const [tokens, sessions] = await Promise.all([
      this.prisma.token.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.refreshSession.deleteMany({
        where: {
          status: { not: RefreshSessionStatus.ACTIVE },
          OR: [{ revokedAt: { lt: cutoff() } }, { usedAt: { lt: cutoff() } }],
        },
      }),
    ]);
    if (tokens.count > 0 || sessions.count > 0) {
      this.logger.log(
        `purged ${tokens.count} tokens, ${sessions.count} sessions`,
      );
    }
    return { tokens: tokens.count, sessions: sessions.count };
  }
}

function cutoff(): Date {
  return new Date(Date.now() - STALE_SESSION_DAYS * 24 * 60 * 60 * 1000);
}

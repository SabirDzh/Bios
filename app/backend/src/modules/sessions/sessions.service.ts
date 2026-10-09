import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RefreshSessionStatus, type RefreshSession } from '@prisma/client';

export class SessionInvalidError extends Error {}
export class SessionExpiredError extends SessionInvalidError {}
export class SessionRevokedError extends SessionInvalidError {}
/** Предъявлен уже ротированный токен — вероятная кража. Семейство отзывается. */
export class SessionReuseError extends SessionInvalidError {
  constructor(public readonly familyId: string) {
    super('refresh token reuse detected, family revoked');
  }
}

export interface CreateSessionInput {
  jti: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RotateSessionInput extends CreateSessionInput {
  /** jti предъявленного (старого) токена */
  presentedJti: string;
  /** sha256 предъявленного токена — для привязки записи */
  presentedTokenHash: string;
}

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<RefreshSession> {
    return this.prisma.refreshSession.create({ data: input });
  }

  /**
   * Атомарная ротация: условный UPDATE (status ACTIVE -> USED) выигрывает ровно
   * один запрос; проигравший видит USED и запускает отзыв семейства.
   * Всё в одной транзакции: пометка старого + создание нового + отзыв при reuse.
   */
  /**
   * Атомарная ротация: условный UPDATE (status ACTIVE -> USED) выигрывает ровно
   * один запрос; проигравший видит USED и запускает отзыв семейства.
   * Пометка старого + создание нового — в одной транзакции. Отзыв семейства
   * при reuse — ОТДЕЛЬНЫМ запросом после: исключение из транзакции вызвало бы
   * её rollback и отменило бы сам отзыв.
   */
  async rotate(
    input: RotateSessionInput,
  ): Promise<{ current: RefreshSession; next: RefreshSession }> {
    const {
      presentedJti,
      presentedTokenHash,
      jti,
      familyId,
      userId,
      tokenHash,
      expiresAt,
    } = input;
    const now = new Date();

    let result: { current: RefreshSession; next: RefreshSession };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshSession.updateMany({
          where: {
            jti: presentedJti,
            userId,
            familyId,
            tokenHash: presentedTokenHash,
            status: RefreshSessionStatus.ACTIVE,
            expiresAt: { gt: now },
          },
          data: { status: RefreshSessionStatus.USED, usedAt: now },
        });

        if (claimed.count === 1) {
          const current = await tx.refreshSession.findUniqueOrThrow({
            where: { jti: presentedJti },
          });
          const next = await tx.refreshSession.create({
            data: { jti, familyId, userId, tokenHash, expiresAt },
          });
          return { current, next };
        }

        // Никто не выиграл: классифицируем предъявленный токен.
        const existing = await tx.refreshSession.findUnique({
          where: { jti: presentedJti },
        });
        if (
          !existing ||
          existing.userId !== userId ||
          existing.tokenHash !== presentedTokenHash
        ) {
          throw new SessionInvalidError('refresh session not found');
        }
        if (existing.status === RefreshSessionStatus.USED) {
          throw new SessionReuseError(existing.familyId);
        }
        if (existing.status === RefreshSessionStatus.REVOKED) {
          throw new SessionRevokedError('refresh session revoked');
        }
        if (existing.expiresAt <= now) {
          throw new SessionExpiredError('refresh session expired');
        }
        // ACTIVE, но условный UPDATE не сработал (гонка с незакоммиченным winner):
        // безопасно отклоняем без выдачи токенов, семейство не трогаем —
        // winner уже пометил токен USED, повтор классифицируется как reuse.
        throw new SessionInvalidError('refresh session conflict');
      });
    } catch (err) {
      if (err instanceof SessionReuseError) {
        // Повторное использование ротированного токена — отзываем всё семейство.
        // Отдельная операция (см. комментарий выше); при сбое БД исключение
        // пробрасывается — fail closed, токены не выдаются.
        await this.revokeFamily(err.familyId);
      }
      throw err;
    }
    return result;
  }

  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { familyId, status: RefreshSessionStatus.ACTIVE },
      data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { userId, status: RefreshSessionStatus.ACTIVE },
      data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
    });
    return result.count;
  }
}

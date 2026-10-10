import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { getAppConfig } from '../../config/app-config.module';
import { RefreshSessionStatus } from '@prisma/client';

export const PURGE_JOB_NAME = 'purgeExpired';

@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly cfg: AppConfig;

  constructor(
    private prisma: PrismaService,
    private scheduler: SchedulerRegistry,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.cfg = config ?? getAppConfig();
  }

  onModuleInit() {
    // Cron нельзя передать через декоратор @Cron (он статичен) — регистрируем
    // динамически из конфига. CronJob — транзитивная зависимость @nestjs/schedule.
    const job = new CronJob(
      this.cfg.maintenance.cron,
      () => void this.purgeExpired(),
      null,
      true,
      this.cfg.maintenance.timeZone,
    );
    this.scheduler.addCronJob(PURGE_JOB_NAME, job);
  }

  async purgeExpired(): Promise<{ tokens: number; sessions: number }> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() -
        this.cfg.maintenance.staleSessionDays * 24 * 60 * 60 * 1000,
    );
    const [tokens, sessions] = await Promise.all([
      this.prisma.token.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.refreshSession.deleteMany({
        where: {
          status: { not: RefreshSessionStatus.ACTIVE },
          OR: [{ revokedAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }],
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

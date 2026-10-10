import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Явный дефолт пула: полагаться на неявный дефолт Prisma
// (num_cpus*2+1, разный на разных хостах) — значит получать разное
// поведение в dev/docker/CI. 10 достаточно для одного инстанса MVP
// (self-host, реплик нет); уже заданный в URL лимит уважаем.
// Экспортирована для тестов.
export const DEFAULT_CONNECTION_LIMIT = 10;

export function withConnectionLimit(
  url: string | undefined,
): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${DEFAULT_CONNECTION_LIMIT}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const url = withConnectionLimit(process.env.DATABASE_URL);
    super(url ? { datasourceUrl: url } : {});
  }

  async onModuleInit() {
    await this.$connect();
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Явный дефолт пула: полагаться на неявный дефолт Prisma
// (num_cpus*2+1, разный на разных хостах) — значит получать разное
// поведение в dev/docker/CI. 10 достаточно для одного инстанса MVP
// (self-host, реплик нет); уже заданный в URL лимит уважаем.
//
// Читаем DB_CONNECTION_LIMIT напрямую, а не через AppConfig: PrismaService
// конструируется в спеках с одним DATABASE_URL, полный конфиг там не
// загружен (прецедент — сам DATABASE_URL тоже вне AppConfig: его нужен
// и Prisma CLI/миграциям). Невалидное значение роняет старт (fail-fast).
export const DEFAULT_CONNECTION_LIMIT = 10;
const MAX_CONNECTION_LIMIT = 100;

export function parseConnectionLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_CONNECTION_LIMIT;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_CONNECTION_LIMIT
  ) {
    throw new Error(
      `Invalid DB_CONNECTION_LIMIT="${raw}": expected integer 1-${MAX_CONNECTION_LIMIT}`,
    );
  }
  return parsed;
}

export function withConnectionLimit(
  url: string | undefined,
  limit: number,
): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${limit}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const url = withConnectionLimit(
      process.env.DATABASE_URL,
      parseConnectionLimit(process.env.DB_CONNECTION_LIMIT),
    );
    super(url ? { datasourceUrl: url } : {});
  }

  async onModuleInit() {
    await this.$connect();
  }
}

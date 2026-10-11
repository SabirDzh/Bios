import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Server } from '@prisma/client';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MeiliService, MeiliUnavailableError } from './meili.service';

/** Порт поиска: потребители зависят от интерфейса, тесты — от двойника (как SSH_RUNNER). */
export const SERVER_SEARCH = Symbol('SERVER_SEARCH');

/** Код конверта 424: движок поиска не отвечает. Маппится в текст на клиенте. */
export const SEARCH_UNAVAILABLE_CODE = 'SEARCH_UNAVAILABLE';

export const SERVERS_INDEX = 'servers';

/** Документы крошечные (4 поля) — крупный батч не рискует размером тела. */
const RESYNC_BATCH = 500;

export interface ServerSearchPort {
  /** Fire-and-forget: сбой движка не должен ронять создание сервера. */
  syncServer(server: Server): void;

  /** Ранжированная выдача движка; строки БД — источник правды о содержимом. */
  searchServers(
    workspaceId: string,
    q: string,
    limit: number,
  ): Promise<{ items: Server[]; total: number }>;
}

/**
 * Документ индекса — только поля поиска и фильтра. Секреты, статусы и
 * отпечатки тут не нужны: выдачу всё равно собирает БД.
 */
interface ServerDoc {
  id: string;
  workspaceId: string;
  name: string;
  host: string;
}

export function toServerDoc(
  server: Pick<Server, 'id' | 'workspaceId' | 'name' | 'host'>,
): ServerDoc {
  return {
    id: server.id,
    workspaceId: server.workspaceId,
    name: server.name,
    host: server.host,
  };
}

@Injectable()
export class ServerSearchService
  implements ServerSearchPort, OnApplicationBootstrap
{
  private readonly logger = new Logger(ServerSearchService.name);
  /** Успешная настройка индекса; сбой сбрасывает — следующая попытка ленива. */
  private ready: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meili: MeiliService,
  ) {}

  onApplicationBootstrap(): void {
    // Не блокирует старт: без движка панель обязана подняться.
    void this.reindex();
  }

  /**
   * Полный ре-индекс: саморемонт после правок мимо API (seed, ручной SQL) и
   * пустого тома движка. Никогда не reject-ит — это путь bootstrap-а.
   */
  async reindex(): Promise<void> {
    try {
      await this.ensureReady();
      const servers = await this.prisma.server.findMany({
        select: { id: true, workspaceId: true, name: true, host: true },
      });
      for (let i = 0; i < servers.length; i += RESYNC_BATCH) {
        await this.meili.upsertDocuments(
          SERVERS_INDEX,
          servers.slice(i, i + RESYNC_BATCH).map(toServerDoc),
        );
      }
      this.logger.log(`search index synced: ${servers.length} server(s)`);
    } catch (err) {
      this.logger.warn(`search index sync skipped: ${(err as Error).message}`);
    }
  }

  syncServer(server: Server): void {
    void (async () => {
      try {
        await this.ensureReady();
        await this.meili.upsertDocuments(SERVERS_INDEX, [toServerDoc(server)]);
      } catch (err) {
        this.logger.warn(
          `server ${server.id} not indexed: ${(err as Error).message}`,
        );
      }
    })();
  }

  async searchServers(
    workspaceId: string,
    q: string,
    limit: number,
  ): Promise<{ items: Server[]; total: number }> {
    let hits: Array<{ id?: unknown }>;
    let total: number;
    try {
      await this.ensureReady();
      const result = await this.meili.search<{ id?: unknown }>(SERVERS_INDEX, {
        q,
        // workspaceId — UUID, проверенный DTO: безопасен в строковом фильтре.
        filter: [`workspaceId = "${workspaceId}"`],
        limit,
      });
      hits = result.hits;
      total = result.total;
    } catch (err) {
      if (err instanceof MeiliUnavailableError) {
        this.logger.warn(`search unavailable: ${err.message}`);
        throw new FailedDependencyException({
          errorCode: SEARCH_UNAVAILABLE_CODE,
          message: 'search engine is unavailable',
        });
      }
      throw err;
    }

    const ids = hits
      .map((hit) => hit.id)
      .filter((id): id is string => typeof id === 'string');
    const rows = await this.prisma.server.findMany({
      where: { id: { in: ids }, workspaceId },
    });
    // Порядок движка — релевантность; БД решает, что из хитов ещё существует.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [row];
    });
    return { items, total };
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.setupIndex().catch((err: unknown) => {
      this.ready = undefined;
      throw err;
    });
    return this.ready;
  }

  private async setupIndex(): Promise<void> {
    await this.meili.setPrimaryKey(SERVERS_INDEX, 'id');
    await this.meili.updateSettings(SERVERS_INDEX, {
      searchableAttributes: ['name', 'host'],
      filterableAttributes: ['workspaceId'],
    });
  }
}

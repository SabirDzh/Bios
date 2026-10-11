import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';

/**
 * Любой сбой движка поиска (сеть, таймаут, неожиданный статус). Поиск —
 * вспомогательная зависимость: наружу это 424 SEARCH_UNAVAILABLE, а не 500.
 */
export class MeiliUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MeiliUnavailableError';
  }
}

export interface MeiliSearchResult<T> {
  hits: T[];
  total: number;
}

interface MeiliResponse {
  status: number;
  body: unknown;
}

/**
 * Минимальный HTTP-клиент Meilisearch на глобальном fetch: официальный SDK
 * не тянем — нужны четыре вызова, и каждый проверяется телом.
 */
@Injectable()
export class MeiliService {
  private readonly host: string;
  private readonly masterKey: string | null;
  private readonly timeoutMs: number;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.host = cfg.meili.host;
    this.masterKey = cfg.meili.masterKey;
    this.timeoutMs = cfg.meili.timeoutMs;
  }

  /**
   * Первичный ключ задаётся явно: у документов есть и `id`, и `workspaceId`,
   * а вывод ключа из формы документа в этом случае недетерминирован.
   */
  async setPrimaryKey(uid: string, primaryKey: string): Promise<void> {
    await this.expect('PATCH', `/indexes/${uid}`, { primaryKey });
  }

  /**
   * Настройки индекса. PATCH автосоздаёт индекс — отдельный POST /indexes не
   * нужен: bootstrap поиска — ровно эти два вызова.
   */
  async updateSettings(
    uid: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    await this.expect('PATCH', `/indexes/${uid}/settings`, settings);
  }

  /** POST /documents — upsert по primaryKey: соседние документы не затираются. */
  async upsertDocuments(uid: string, documents: unknown[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.expect('POST', `/indexes/${uid}/documents`, documents);
  }

  async search<T>(
    uid: string,
    body: { q: string; filter?: string[]; limit?: number },
  ): Promise<MeiliSearchResult<T>> {
    const raw = await this.expect('POST', `/indexes/${uid}/search`, body);
    const parsed = raw as { hits?: unknown; estimatedTotalHits?: unknown };
    if (
      !Array.isArray(parsed.hits) ||
      typeof parsed.estimatedTotalHits !== 'number'
    ) {
      throw new MeiliUnavailableError(
        'meilisearch search returned an unexpected response shape',
      );
    }
    return { hits: parsed.hits as T[], total: parsed.estimatedTotalHits };
  }

  private async expect(
    method: string,
    path: string,
    body?: unknown,
    accepted: readonly number[] = [200, 201, 202, 204],
  ): Promise<unknown> {
    const { status, body: parsed } = await this.request(method, path, body);
    if (!accepted.includes(status)) {
      throw new MeiliUnavailableError(
        `meilisearch ${method} ${path} -> ${status}`,
        { cause: parsed },
      );
    }
    return parsed;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<MeiliResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.host}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.masterKey === null
            ? {}
            : { Authorization: `Bearer ${this.masterKey}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new MeiliUnavailableError(
        `meilisearch ${method} ${path} failed: ${(err as Error).message}`,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    return { status: res.status, body: parsed };
  }
}

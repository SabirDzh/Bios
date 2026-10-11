import { apiGet, apiPost, withCursor } from './client';
import type { ApiFetchOptions } from './client';
import type {
  CreateServerInput,
  CursorPage,
  CursorParams,
  Server,
  ServerSearchResult,
  ServerTestResult,
  TestConnectionInput,
  TestServerInput,
} from './types';

export const serversApi = {
  list(
    workspaceId: string,
    params?: CursorParams,
    init?: ApiFetchOptions,
  ): Promise<CursorPage<Server>> {
    return apiGet<CursorPage<Server>>(
      withCursor(`/workspaces/${workspaceId}/servers`, params),
      init,
    );
  },
  create(workspaceId: string, input: CreateServerInput): Promise<Server> {
    return apiPost<Server>(`/workspaces/${workspaceId}/servers`, input);
  },
  /** Результаты (включая «хост недоступен») приходят телом 200, а не ошибкой. */
  test(
    workspaceId: string,
    serverId: string,
    input?: TestServerInput,
  ): Promise<ServerTestResult> {
    return apiPost<ServerTestResult>(
      `/workspaces/${workspaceId}/servers/${serverId}/test`,
      input ?? {},
    );
  },
  /** Проверка соединения по данным мастера — без создания сервера в БД. */
  testConnection(
    workspaceId: string,
    input: TestConnectionInput,
  ): Promise<ServerTestResult> {
    return apiPost<ServerTestResult>(
      `/workspaces/${workspaceId}/servers/test-connection`,
      input,
    );
  },
  /**
   * Поиск по всем серверам пространства (Meilisearch на бэкенде), а не по
   * загруженным страницам. Пустой q бэкенд отклоняет 400 — звать только с
   * непустым запросом; signal отменяет устаревшие запросы при наборе.
   */
  search(
    workspaceId: string,
    q: string,
    init?: ApiFetchOptions,
  ): Promise<ServerSearchResult> {
    const qs = new URLSearchParams({ q });
    return apiGet<ServerSearchResult>(
      `/workspaces/${workspaceId}/servers/search?${qs.toString()}`,
      init,
    );
  },
};

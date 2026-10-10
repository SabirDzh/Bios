function apiBase(): string {
  // import.meta.env существует только под Vite; вне бандла — дефолт.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_URL ?? 'http://localhost:3000';
}

const API_PREFIX = '/api/v1';

export function apiUrl(path: string): string {
  return `${apiBase()}${API_PREFIX}${path}`;
}

/** Ошибка API: повторяет envelope бэкенда { statusCode, message }. */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  }
  return `Request failed with status ${status}`;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function doFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// Single-flight refresh: параллельные 401 ждут один refresh.
// Обязательно: сервер отзывает семейство при reuse, двойной refresh убил бы сессию.
let refreshPromise: Promise<void> | undefined;

// Сессия признана мёртвой (refresh ответил 401/403) — не долбим refresh на
// каждый последующий 401. Сбрасывается успешным входом (authApi.login).
let refreshDisabled = false;

export function resetRefreshState(): void {
  refreshDisabled = false;
}

async function refreshSession(): Promise<void> {
  refreshPromise ??= (async () => {
    try {
      const res = await doFetch('/auth/refresh', { method: 'POST' });
      // Тело не читаем: refresh либо выставил куки (2xx), либо нет.
      await res.text().catch(() => undefined);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) refreshDisabled = true;
        throw new ApiError(res.status, 'Session refresh failed');
      }
    } finally {
      refreshPromise = undefined;
    }
  })();
  return refreshPromise;
}

export interface ApiFetchOptions extends RequestInit {
  /** Повторить запрос после refresh при 401. Выключается для самого refresh/logout. */
  retryOnAuth?: boolean;
}

/**
 * Типизированный fetch к API.
 * - Куки всегда (`credentials: include`).
 * - 401 → один refresh → один повтор (кроме `retryOnAuth: false`).
 * - 4xx/5xx → `ApiError` (без ретраев: err-retry-config).
 */
export async function apiFetch<T>(
  path: string,
  init?: ApiFetchOptions,
): Promise<T> {
  const { retryOnAuth = true, ...fetchInit } = init ?? {};
  const res = await doFetch(path, fetchInit);

  if (
    res.status === 401 &&
    retryOnAuth &&
    path !== '/auth/refresh' &&
    !refreshDisabled
  ) {
    await refreshSession();
    const retryRes = await doFetch(path, fetchInit);
    if (!retryRes.ok) {
      throw new ApiError(
        retryRes.status,
        errorMessage(retryRes.status, await parseBody(retryRes)),
      );
    }
    return (await parseBody(retryRes)) as T;
  }

  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(res.status, await parseBody(res)));
  }
  return (await parseBody(res)) as T;
}

export function apiGet<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  return apiFetch<T>(path, { ...init, method: 'GET' });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  init?: ApiFetchOptions,
): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  init?: ApiFetchOptions,
): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

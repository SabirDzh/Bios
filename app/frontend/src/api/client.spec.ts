import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError, apiGet, resetRefreshState } from './client';

beforeEach(() => resetRefreshState());
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('401 → один refresh → повтор запроса', async () => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/refresh')) return jsonResponse(200, {});
    if (calls.filter((c) => c.includes('/workers')).length === 1) {
      return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
    }
    return jsonResponse(200, { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(apiGet('/workers')).resolves.toEqual({ ok: true });
  expect(calls.filter((c) => c.endsWith('/auth/refresh')).length).toBe(1);
  expect(calls.filter((c) => c.includes('/workers')).length).toBe(2);
});

test('параллельные 401 используют один refresh (single-flight)', async () => {
  let refreshCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, {});
    }
    if (refreshCalls === 0) {
      return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
    }
    return jsonResponse(200, { ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);

  await Promise.all([apiGet('/a'), apiGet('/b')]);
  expect(refreshCalls).toBe(1);
});

test('4xx без повтора → ApiError с текстом из envelope', async () => {
  const fetchMock = vi.fn(async () =>
    jsonResponse(404, { statusCode: 404, message: 'workspace not found' }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const err = await apiGet('/x').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(404);
  expect((err as ApiError).message).toBe('workspace not found');
});

test('424 → payload с errorCode сохраняется в ApiError (словарь кодов)', async () => {
  const fetchMock = vi.fn(async () =>
    jsonResponse(424, {
      statusCode: 424,
      errorCode: 'TARGET_BLOCKED',
      message: 'target address is not allowed',
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const err = await apiGet('/servers/1/test').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).payload).toMatchObject({ errorCode: 'TARGET_BLOCKED' });
});

test('после failed refresh ошибка пробрасывается, повтора нет', async () => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/refresh')) {
      return jsonResponse(401, { statusCode: 401, message: 'invalid refresh token' });
    }
    return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(apiGet('/secure')).rejects.toBeInstanceOf(ApiError);
  expect(calls.filter((c) => c.includes('/secure')).length).toBe(1);
});

test('мёртвая сессия запоминается: повторные 401 не дёргают refresh', async () => {
  let refreshCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(401, { statusCode: 401, message: 'invalid refresh token' });
    }
    return jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(apiGet('/a')).rejects.toBeInstanceOf(ApiError);
  await expect(apiGet('/b')).rejects.toBeInstanceOf(ApiError);
  expect(refreshCalls).toBe(1);
});

import type { AppConfig } from '../../config/app.config';
import { testAppConfig } from '../../config/testing/app-config.fixture';
import { MeiliService, MeiliUnavailableError } from './meili.service';

function cfg(meili: Partial<AppConfig['meili']> = {}): AppConfig {
  const base = testAppConfig();
  return { ...base, meili: { ...base.meili, ...meili } };
}

/** Ответ-двойник fetch: клиенту нужны только status и text(). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

describe('MeiliService', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('updateSettings: PATCH с ключом в Authorization', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { taskUid: 1 }));
    const service = new MeiliService(cfg({ masterKey: 'k'.repeat(16) }));

    await service.updateSettings('servers', { searchableAttributes: ['name'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7700/indexes/servers/settings');
    expect(init.method).toBe('PATCH');
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${'k'.repeat(16)}`);
    expect(JSON.parse(init.body as string)).toEqual({
      searchableAttributes: ['name'],
    });
  });

  test('без ключа Authorization нет; upsertDocuments шлёт массив документов', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { taskUid: 2 }));
    const service = new MeiliService(cfg());

    await service.upsertDocuments('servers', [{ id: 's1' }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7700/indexes/servers/documents');
    expect(init.method).toBe('POST');
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual([{ id: 's1' }]);
  });

  test('setPrimaryKey: PATCH /indexes/:uid с телом primaryKey', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { taskUid: 3 }));
    const service = new MeiliService(cfg());

    await service.setPrimaryKey('servers', 'id');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7700/indexes/servers');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ primaryKey: 'id' });
  });

  test('upsertDocuments с пустым списком не дёргает движок', async () => {
    const service = new MeiliService(cfg());
    await service.upsertDocuments('servers', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('search: тело с q/filter/limit, ответ разбирается в hits/total', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { hits: [{ id: 'a' }], estimatedTotalHits: 5 }),
    );
    const service = new MeiliService(cfg());

    const result = await service.search('servers', {
      q: 'prod',
      filter: ['workspaceId = "w1"'],
      limit: 50,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7700/indexes/servers/search');
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'prod',
      filter: ['workspaceId = "w1"'],
      limit: 50,
    });
    expect(result).toEqual({ hits: [{ id: 'a' }], total: 5 });
  });

  test('неожиданный статус — MeiliUnavailableError с телом в cause', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }));
    const service = new MeiliService(cfg());

    await expect(service.search('servers', { q: 'x' })).rejects.toBeInstanceOf(
      MeiliUnavailableError,
    );
  });

  test('кривой ответ search — MeiliUnavailableError, а не молчаливый ноль', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: true }));
    const service = new MeiliService(cfg());

    await expect(service.search('servers', { q: 'x' })).rejects.toBeInstanceOf(
      MeiliUnavailableError,
    );
  });

  test('сетевой сбой — MeiliUnavailableError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new MeiliService(cfg());

    await expect(
      service.updateSettings('servers', {}),
    ).rejects.toBeInstanceOf(MeiliUnavailableError);
  });
});

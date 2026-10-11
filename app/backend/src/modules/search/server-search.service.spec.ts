import { HttpException } from '@nestjs/common';
import type { Server } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MeiliService, MeiliUnavailableError } from './meili.service';
import {
  SEARCH_UNAVAILABLE_CODE,
  ServerSearchService,
} from './server-search.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_search?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

interface SearchCall {
  uid: string;
  body: { q: string; filter?: string[]; limit?: number };
}

class FakeMeili {
  primaryKeys: Array<{ uid: string; primaryKey: string }> = [];
  settings: Array<{ uid: string; settings: Record<string, unknown> }> = [];
  upserts: Array<{ uid: string; docs: unknown[] }> = [];
  searchCalls: SearchCall[] = [];
  hits: Array<{ id: string }> = [];
  total = 0;
  fail: Error | null = null;

  async setPrimaryKey(uid: string, primaryKey: string): Promise<void> {
    if (this.fail) throw this.fail;
    this.primaryKeys.push({ uid, primaryKey });
  }

  async updateSettings(
    uid: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    if (this.fail) throw this.fail;
    this.settings.push({ uid, settings });
  }

  async upsertDocuments(uid: string, docs: unknown[]): Promise<void> {
    if (this.fail) throw this.fail;
    if (docs.length === 0) return;
    this.upserts.push({ uid, docs });
  }

  async search<T>(
    uid: string,
    body: SearchCall['body'],
  ): Promise<{ hits: T[]; total: number }> {
    if (this.fail) throw this.fail;
    this.searchCalls.push({ uid, body });
    return { hits: this.hits as T[], total: this.total };
  }
}

/** Fire-and-forget уходит в микротаски: даём им пройти. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ServerSearchService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let meili: FakeMeili;
  let service: ServerSearchService;
  let ownerId: string;
  let workspaceId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    meili = new FakeMeili();
    service = new ServerSearchService(
      prisma,
      meili as unknown as MeiliService,
    );
    ownerId = (
      await users.create({
        username: `searchowner${n}`,
        email: `searchowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `search-ws-${n}` }))
      .id;
  });

  afterEach(async () => {
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  async function makeServer(name: string, ws = workspaceId): Promise<Server> {
    return prisma.server.create({
      data: {
        workspaceId: ws,
        name,
        host: `${name}.example.com`,
        port: 22,
        sshUsername: 'deploy',
        authType: 'PASSWORD',
        secretCipher: 'x',
      },
    });
  }

  test('searchServers: фильтр по воркспейсу, порядок движка, total из движка', async () => {
    const a = await makeServer('prod-a');
    const b = await makeServer('prod-b');
    meili.hits = [{ id: b.id }, { id: a.id }];
    meili.total = 7;

    const result = await service.searchServers(workspaceId, 'prod', 50);

    expect(meili.searchCalls).toEqual([
      {
        uid: 'servers',
        body: {
          q: 'prod',
          filter: [`workspaceId = "${workspaceId}"`],
          limit: 50,
        },
      },
    ]);
    expect(result.items.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(result.total).toBe(7);
  });

  test('хит чужого воркспейса не протекает — строки режет БД', async () => {
    const own = await makeServer('own-1');
    const otherOwner = await users.create({
      username: `searchowner-other${n}`,
      email: `searchowner-other${n}@example.com`,
      password: 'secret123',
    });
    const otherWs = (
      await workspaces.create(otherOwner.id, { name: `search-other-${n}` })
    ).id;
    const foreign = await makeServer('foreign-1', otherWs);
    meili.hits = [{ id: foreign.id }, { id: own.id }];
    meili.total = 2;

    const result = await service.searchServers(workspaceId, 'x', 50);

    expect(result.items.map((s) => s.id)).toEqual([own.id]);
  });

  test('устаревший хит (строки уже нет) молча выпадает из выдачи', async () => {
    const alive = await makeServer('alive-1');
    meili.hits = [{ id: 'dead-beef' }, { id: alive.id }];
    meili.total = 2;

    const result = await service.searchServers(workspaceId, 'x', 50);

    expect(result.items.map((s) => s.id)).toEqual([alive.id]);
  });

  test('сбой движка при поиске — 424 SEARCH_UNAVAILABLE', async () => {
    meili.fail = new MeiliUnavailableError('down');

    const err = await service
      .searchServers(workspaceId, 'x', 50)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(424);
    expect((err as HttpException).getResponse()).toMatchObject({
      errorCode: SEARCH_UNAVAILABLE_CODE,
    });
  });

  test('после сбоя настройка индекса повторяется при следующем поиске', async () => {
    meili.fail = new MeiliUnavailableError('down');
    await service.searchServers(workspaceId, 'x', 50).catch(() => undefined);
    expect(meili.settings).toHaveLength(0);

    meili.fail = null;
    await service.searchServers(workspaceId, 'x', 50);

    expect(meili.primaryKeys).toEqual([
      { uid: 'servers', primaryKey: 'id' },
    ]);
    expect(meili.settings).toEqual([
      {
        uid: 'servers',
        settings: {
          searchableAttributes: ['name', 'host'],
          filterableAttributes: ['workspaceId'],
        },
      },
    ]);
  });

  test('syncServer: документ — ровно поля поиска, без секретов', async () => {
    const server = await makeServer('sync-1');

    service.syncServer(server);
    await tick();

    expect(meili.upserts).toHaveLength(1);
    const doc = meili.upserts[0].docs[0] as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual([
      'host',
      'id',
      'name',
      'workspaceId',
    ]);
    expect(doc).toEqual({
      id: server.id,
      workspaceId,
      name: 'sync-1',
      host: 'sync-1.example.com',
    });
  });

  test('syncServer: сбой движка глотается — создание сервера не падает', async () => {
    meili.fail = new MeiliUnavailableError('down');
    const server = await makeServer('sync-2');

    service.syncServer(server);
    await tick();

    expect(meili.upserts).toHaveLength(0);
  });

  test('reindex: все серверы уезжают в индекс; сбой не валит бут', async () => {
    await makeServer('r-1');
    await makeServer('r-2');

    await service.reindex();
    const docs = meili.upserts.flatMap((u) => u.docs);
    expect(docs).toHaveLength(2);

    meili.upserts = [];
    meili.fail = new MeiliUnavailableError('down');
    await expect(service.reindex()).resolves.toBeUndefined();
    expect(meili.upserts).toHaveLength(0);
  });
});

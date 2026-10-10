import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from './workspaces.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_workspaces?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('workspaces create/list/get', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
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

  async function registerUser() {
    n += 1;
    return users.create({
      username: `wsuser${n}`,
      email: `wsuser${n}@example.com`,
      password: 'secret123',
    });
  }

  afterEach(async () => {
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  test('create assigns OWNER to creator', async () => {
    const user = await registerUser();
    const ws = await workspaces.create(user.id, { name: '  Team Alpha ' });
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe('Team Alpha');
    expect(ws.role).toBe('OWNER');
  });

  test('list shows own workspaces only', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await workspaces.create(a.id, { name: 'a-one' });
    await workspaces.create(a.id, { name: 'a-two' });
    await workspaces.create(b.id, { name: 'b-one' });

    const list = await workspaces.findAllForUser(a.id, {});
    expect(list.items.map((w) => w.name).sort()).toEqual(['a-one', 'a-two']);
    expect(list.items.every((w) => w.role === 'OWNER')).toBe(true);
    expect(list.nextCursor).toBeNull();
  });

  test('cursor walk: страницы без дублей и пропусков, мусор — 400', async () => {
    const user = await registerUser();
    for (const name of ['w-one', 'w-two', 'w-three']) {
      await workspaces.create(user.id, { name });
    }
    const page1 = await workspaces.findAllForUser(user.id, { limit: 2 });
    expect(page1.items.map((w) => w.name)).toEqual(['w-one', 'w-two']);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = await workspaces.findAllForUser(user.id, {
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(page2.items.map((w) => w.name)).toEqual(['w-three']);
    expect(page2.nextCursor).toBeNull();
    expect([...page1.items, ...page2.items]).toHaveLength(3);

    await expect(
      workspaces.findAllForUser(user.id, { cursor: 'garbage!!' }),
    ).rejects.toThrow();
  });

  test('get чужого workspace неотличим от несуществующего (404)', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const ws = await workspaces.create(a.id, { name: 'secret' });

    await expect(workspaces.findOneForUser(b.id, ws.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      workspaces.findOneForUser(b.id, '01912345-6789-7abc-aef0-1234567890ab'),
    ).rejects.toThrow(NotFoundException);
  });

  test('get своего возвращает workspace с ролью', async () => {
    const user = await registerUser();
    const created = await workspaces.create(user.id, { name: 'mine' });
    const found = await workspaces.findOneForUser(user.id, created.id);
    expect(found.id).toBe(created.id);
    expect(found.role).toBe('OWNER');
  });

  test('requireMembership: роль, 404 для чужих, 403 для не-OWNER', async () => {
    const owner = await registerUser();
    const outsider = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'roles' });

    await expect(workspaces.requireMembership(owner.id, ws.id)).resolves.toBe(
      'OWNER',
    );
    await expect(
      workspaces.requireMembership(outsider.id, ws.id),
    ).rejects.toThrow(NotFoundException);
    await expect(
      workspaces.requireMembership(
        owner.id,
        '01912345-6789-7abc-aef0-1234567890ab',
        [WorkspaceRole.MEMBER],
      ),
    ).rejects.toThrow(NotFoundException);

    const invitation = await workspaces.invite(
      owner.id,
      ws.id,
      'rolemember@example.com',
    );
    const member = await users.create({
      username: 'rolemember',
      email: 'rolemember@example.com',
      password: 'secret123',
    });
    await workspaces.accept(member.id, ws.id, invitation.token);
    await expect(
      workspaces.requireMembership(member.id, ws.id, [WorkspaceRole.OWNER]),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      workspaces.requireMembership(member.id, ws.id, [WorkspaceRole.MEMBER]),
    ).resolves.toBe('MEMBER');
  });
});

describe('workspace invitations', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let n = 1000;

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

  async function registerUser() {
    n += 1;
    return users.create({
      username: `wsinv${n}`,
      email: `wsinv${n}@example.com`,
      password: 'secret123',
    });
  }

  afterEach(async () => {
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  test('OWNER создает инвайт с одноразовым токеном; в БД только хэш', async () => {
    const owner = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv = await workspaces.invite(owner.id, ws.id, 'Friend@Example.com');

    expect(inv.status).toBe('PENDING');
    expect(inv.email).toBe('friend@example.com');
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await prisma.workspaceInvitation.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(row.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(inv.token);
  });

  test('MEMBER приглашать не может (403), чужой workspace (404)', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const outsider = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv = await workspaces.invite(owner.id, ws.id, member.email);
    await workspaces.accept(member.id, ws.id, inv.token);

    await expect(
      workspaces.invite(member.id, ws.id, 'x@example.com'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      workspaces.invite(outsider.id, ws.id, 'x@example.com'),
    ).rejects.toThrow(NotFoundException);
  });

  test('инвайт участнику -> 409', async () => {
    const owner = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    await expect(
      workspaces.invite(owner.id, ws.id, owner.email),
    ).rejects.toThrow(ConflictException);
  });

  test('accept валидным токеном; повтор -> 404', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv = await workspaces.invite(owner.id, ws.id, member.email);

    const m = await workspaces.accept(member.id, ws.id, inv.token);
    expect(m.role).toBe('MEMBER');
    expect(m.workspaceId).toBe(ws.id);

    await expect(
      workspaces.accept(member.id, ws.id, inv.token),
    ).rejects.toThrow(NotFoundException);
  });

  test('просроченный token -> 404 наружу и EXPIRED в БД', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv = await workspaces.invite(owner.id, ws.id, member.email);
    await prisma.workspaceInvitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      workspaces.accept(member.id, ws.id, inv.token),
    ).rejects.toThrow(NotFoundException);
    const row = await prisma.workspaceInvitation.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(row.status).toBe('EXPIRED');
    // Токен мёртв навсегда.
    await expect(
      workspaces.accept(member.id, ws.id, inv.token),
    ).rejects.toThrow(NotFoundException);
  });

  test('token другого воркспейса и чужой email -> 404 / 403', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const stranger = await registerUser();
    const ws1 = await workspaces.create(owner.id, { name: 'one' });
    const ws2 = await workspaces.create(owner.id, { name: 'two' });
    const inv = await workspaces.invite(owner.id, ws1.id, member.email);

    await expect(
      workspaces.accept(member.id, ws2.id, inv.token),
    ).rejects.toThrow(NotFoundException);
    await expect(
      workspaces.accept(stranger.id, ws1.id, inv.token),
    ).rejects.toThrow(ForbiddenException);
    // Токен не сгорел от чужих попыток: легитимный accept проходит.
    const m = await workspaces.accept(member.id, ws1.id, inv.token);
    expect(m.role).toBe('MEMBER');
  });

  test('параллельный accept: ровно один 201, дубля нет', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv = await workspaces.invite(owner.id, ws.id, member.email);

    const results = await Promise.allSettled([
      workspaces.accept(member.id, ws.id, inv.token),
      workspaces.accept(member.id, ws.id, inv.token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId: ws.id, userId: member.id },
      }),
    ).toBe(1);
  });

  test('повторный invite supersedeʼит первый', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });
    const inv1 = await workspaces.invite(owner.id, ws.id, member.email);
    const inv2 = await workspaces.invite(owner.id, ws.id, member.email);
    expect(inv2.token).not.toBe(inv1.token);

    await expect(
      workspaces.accept(member.id, ws.id, inv1.token),
    ).rejects.toThrow(NotFoundException);
    const m = await workspaces.accept(member.id, ws.id, inv2.token);
    expect(m.role).toBe('MEMBER');
  });

  test('параллельный invite на один email: ровно один 201', async () => {
    const owner = await registerUser();
    const ws = await workspaces.create(owner.id, { name: 'team' });

    const results = await Promise.allSettled([
      workspaces.invite(owner.id, ws.id, 'new@example.com'),
      workspaces.invite(owner.id, ws.id, 'new@example.com'),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(ConflictException);
  });
});

import { NotFoundException } from '@nestjs/common';
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

    const list = await workspaces.findAllForUser(a.id);
    expect(list.map((w) => w.name).sort()).toEqual(['a-one', 'a-two']);
    expect(list.every((w) => w.role === 'OWNER')).toBe(true);
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
});

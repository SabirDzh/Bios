/* eslint-disable @typescript-eslint/unbound-method -- спек намеренно передаёт
   сырые референсы методов: Reflector читает метадату именно с них — так же,
   как Nest передаёт хендлеры в guard в рантайме. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  MinRole,
  WorkspaceRoleGuard,
  type WorkspaceRequest,
} from './workspace-role.guard';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_guards?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

function execContext(req: Partial<WorkspaceRequest>, handler: () => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as Parameters<WorkspaceRoleGuard['canActivate']>[0];
}

class TestController {
  @MinRole(WorkspaceRole.MEMBER)
  memberRoute() {}

  @MinRole(WorkspaceRole.OWNER)
  ownerRoute() {}

  openRoute() {}
}

describe('WorkspaceRoleGuard', () => {
  let prisma: PrismaService;
  let guard: WorkspaceRoleGuard;
  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  let workspaceId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    guard = new WorkspaceRoleGuard(prisma, new Reflector());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: {
          username: `guard${tag}${n}`,
          email: `guard${tag}${n}@example.com`,
          canonicalEmail: `guard${tag}${n}@example.com`,
          password: 'x'.repeat(60),
        },
      });
    ownerId = (await mkUser('owner')).id;
    memberId = (await mkUser('member')).id;
    outsiderId = (await mkUser('outsider')).id;
    workspaceId = (
      await prisma.workspace.create({ data: { name: `guard-ws-${n}` } })
    ).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: ownerId, role: WorkspaceRole.OWNER },
        { workspaceId, userId: memberId, role: WorkspaceRole.MEMBER },
      ],
    });
  });

  afterEach(async () => {
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function req(
    userId: string,
    wsId: string | null = workspaceId,
  ): Partial<WorkspaceRequest> {
    return {
      ...(wsId === null ? {} : { params: { workspaceId: wsId } }),
      user: { userId, username: 'u', email: 'u@e.c', sid: 's' },
    };
  }

  test('без @MinRole пропускает (auth-only роуты)', async () => {
    const c = new TestController();
    await expect(
      guard.canActivate(execContext(req(outsiderId), c.openRoute)),
    ).resolves.toBe(true);
  });

  test('участник проходит MEMBER-роут, роль кладётся в request', async () => {
    const c = new TestController();
    const r = req(memberId);
    await expect(
      guard.canActivate(execContext(r, c.memberRoute)),
    ).resolves.toBe(true);
    expect(r.workspaceRole).toBe(WorkspaceRole.MEMBER);
  });

  test('участник не проходит OWNER-роут (403)', async () => {
    const c = new TestController();
    await expect(
      guard.canActivate(execContext(req(memberId), c.ownerRoute)),
    ).rejects.toThrow(ForbiddenException);
  });

  test('владелец проходит OWNER-роут', async () => {
    const c = new TestController();
    await expect(
      guard.canActivate(execContext(req(ownerId), c.ownerRoute)),
    ).resolves.toBe(true);
  });

  test('чужой неотличим от несуществующего (404, без oracle)', async () => {
    const c = new TestController();
    await expect(
      guard.canActivate(execContext(req(outsiderId), c.memberRoute)),
    ).rejects.toThrow(NotFoundException);
  });

  test('@MinRole без workspaceId в пути — 404 (fail-closed)', async () => {
    const c = new TestController();
    await expect(
      guard.canActivate(execContext(req(ownerId, null), c.memberRoute)),
    ).rejects.toThrow(NotFoundException);
  });
});

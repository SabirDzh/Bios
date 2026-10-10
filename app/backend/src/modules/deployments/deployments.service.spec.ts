import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CredentialCryptoService } from '../servers/credentials/credential-crypto.service';
import { FakeSshRunner } from '../servers/ssh/fake-ssh.runner';
import { testAppConfig } from '../../config/testing/app-config.fixture';
import { ProjectsService } from '../projects/projects.service';
import { DeployConfigsService } from '../projects/deploy-configs.service';
import { DeployRunnerService } from './deploy-runner.service';
import { DeploymentsService } from './deployments.service';
import type { CreateDeploymentDto } from './dto/create-deployment.dto';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deployments?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const SECRET = 'sup3rsecret';

describe('DeploymentsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
  let configs: DeployConfigsService;
  let ssh: FakeSshRunner;
  let pumps: number;
  let deployments: DeploymentsService;
  let ownerId: string;
  let workspaceId: string;
  let projectId: string;
  let configId: string;
  let otherConfigId: string;
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
    pumps = 0;
    ssh = new FakeSshRunner();
    const credentials = new CredentialCryptoService(testAppConfig());
    projects = new ProjectsService(prisma, workspaces);
    configs = new DeployConfigsService(prisma, workspaces, projects);
    // Исполнитель подменяется шпионом: Task 6 отвечает за то, как он исполняет,
    // здесь важен только контракт «постановка в очередь будит pump ровно один раз».
    const runner = {
      pump: () => {
        pumps += 1;
      },
    } as unknown as DeployRunnerService;
    deployments = new DeploymentsService(
      prisma,
      workspaces,
      projects,
      configs,
      runner,
    );

    ownerId = (
      await users.create({
        username: `dsvc${n}`,
        email: `dsvc${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `dsvc-ws-${n}` }))
      .id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-1',
        host: '203.0.113.22',
        port: 22,
        sshUsername: 'root',
        authType: ServerAuthType.PASSWORD,
        secretCipher: credentials.encrypt(SECRET),
        hostKeyFingerprint:
          'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    const project = await projects.create(ownerId, workspaceId, {
      name: 'shop',
      repoUrl: 'https://github.com/octocat/hello-world.git',
    });
    projectId = project.id;
    configId = (
      await configs.create(ownerId, workspaceId, projectId, {
        name: 'prod',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'shop-web',
        serverId: server.id,
      })
    ).id;
    otherConfigId = (
      await configs.create(ownerId, workspaceId, projectId, {
        name: 'staging',
        method: 'GIT_PULL',
        ref: 'develop',
        containerName: 'shop-staging',
        serverId: server.id,
      })
    ).id;
  });

  afterEach(async () => {
    await ssh.closeMock();
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(
    overrides: Partial<CreateDeploymentDto> = {},
  ): CreateDeploymentDto {
    return { projectId, configId, ...overrides };
  }

  test('create: QUEUED, слот занят, снимок на месте, очередь разбужена ровно раз', async () => {
    const res = await deployments.create(ownerId, workspaceId, dto());

    expect(res).toMatchObject({
      projectId,
      configId,
      status: 'QUEUED',
      step: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      triggeredById: ownerId,
      errorCode: null,
      imageTag: null,
    });
    expect(pumps).toBe(1);

    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: res.id },
    });
    expect(row.activeConfigId).toBe(configId);
    expect(row.snapshot).toMatchObject({
      ref: 'master',
      containerName: 'shop-web',
      ports: [],
      method: 'GIT_PULL',
      repoUrl: 'https://github.com/octocat/hello-world.git',
    });
  });

  test('create: активная задача этой же конфигурации — 409, новой строки нет, исполнитель молчит', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    pumps = 0;

    await expect(
      deployments.create(ownerId, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.deployment.count()).toBe(1);
    // отказ на вставке очередь не будит
    expect(pumps).toBe(0);
  });

  test('после завершения слот свободен: вторая задача той же конфигурации проходит', async () => {
    const first = await deployments.create(ownerId, workspaceId, dto());
    await prisma.deployment.update({
      where: { id: first.id },
      data: { status: 'SUCCESS', activeConfigId: null },
    });
    const second = await deployments.create(ownerId, workspaceId, dto());
    expect(second.status).toBe('QUEUED');
    expect(second.id).not.toBe(first.id);
  });

  test('разные конфигурации одного проекта не спорят за слот', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    const other = await deployments.create(
      ownerId,
      workspaceId,
      dto({ configId: otherConfigId }),
    );
    expect(other.configId).toBe(otherConfigId);
    expect(pumps).toBe(2);
  });

  test('create: чужой проект — 404, конфигурация из другого проекта — 404, MEMBER — 403', async () => {
    const otherWs = await workspaces.create(ownerId, { name: 'ds-other' });
    const foreignProject = await projects.create(ownerId, otherWs.id, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await expect(
      deployments.create(
        ownerId,
        workspaceId,
        dto({ projectId: foreignProject.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const otherProject = await projects.create(ownerId, workspaceId, {
      name: 'other',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await expect(
      deployments.create(
        ownerId,
        workspaceId,
        dto({ projectId: otherProject.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // configId принадлежит projectId, а не otherProject — это тот же 404
    await expect(
      deployments.create(ownerId, workspaceId, {
        projectId: otherProject.id,
        configId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const memberId = (
      await users.create({
        username: `dsmem${n}`,
        email: `dsmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId, role: 'MEMBER' },
    });
    await expect(
      deployments.create(memberId, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pumps).toBe(0);
  });

  test('list: свежие первыми, фильтры по проекту и конфигурации, limit применяется', async () => {
    const a = await deployments.create(ownerId, workspaceId, dto({ configId }));
    await prisma.deployment.update({
      where: { id: a.id },
      data: { status: 'SUCCESS', activeConfigId: null },
    });
    const b = await deployments.create(
      ownerId,
      workspaceId,
      dto({ configId: otherConfigId }),
    );

    const all = await deployments.findAll(ownerId, workspaceId, {});
    expect(all.map((row) => row.id)).toEqual([b.id, a.id]);
    expect(
      await deployments.findAll(ownerId, workspaceId, {
        configId: otherConfigId,
      }),
    ).toEqual([expect.objectContaining({ id: b.id })]);
    expect(
      await deployments.findAll(ownerId, workspaceId, { projectId: 'nope' }),
    ).toEqual([]);
    expect(
      await deployments.findAll(ownerId, workspaceId, { limit: '1' }),
    ).toHaveLength(1);
    expect(
      await deployments.findAll(ownerId, workspaceId, { limit: '999' }),
    ).toHaveLength(2);
  });

  test('list: не участник воркспейса — 404, как везде в панели', async () => {
    await deployments.create(ownerId, workspaceId, dto());
    const stranger = (
      await users.create({
        username: `dsstr${n}`,
        email: `dsstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    // Не 403: `requireMembership` бросает NotFoundException, когда строки
    // членства нет (workspaces.service.ts:152), и часть 3/4 живёт по этому
    // правилу — чужой воркспейс неотличим от несуществующего. 403 получает
    // УЧАСТНИК с ролью MEMBER (тест create выше).
    await expect(
      deployments.findAll(stranger, workspaceId, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('findOne и logs: участник видит свою задачу, чужак получает 404 на оба', async () => {
    const created = await deployments.create(ownerId, workspaceId, dto());
    const liveLog = '\n===== build =====\nnaming to image';
    await prisma.deployment.update({
      where: { id: created.id },
      data: { status: 'RUNNING', step: 'BUILD', log: liveLog },
    });

    expect(await deployments.findOne(ownerId, created.id)).toMatchObject({
      id: created.id,
      status: 'RUNNING',
      step: 'build',
    });
    expect(await deployments.logs(ownerId, created.id)).toEqual({
      deploymentId: created.id,
      status: 'RUNNING',
      finished: false,
      log: liveLog,
      sizeBytes: Buffer.byteLength(liveLog, 'utf8'),
    });

    const otherWs = await workspaces.create(ownerId, { name: 'ds-other2' });
    const stranger = (
      await users.create({
        username: `dstr${n}`,
        email: `dstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    // участник другого воркспейса: задача существует, но 403 запрещает даже
    // подтвердить это — наружу уходит 404
    expect(otherWs.id).not.toBe(workspaceId);
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: stranger, role: 'MEMBER' },
    });
    await expect(
      deployments.findOne(stranger, created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(deployments.logs(stranger, created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      deployments.findOne(ownerId, '01912345-6789-7abc-aef0-1234567890ff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('logs: завершённые статусы дают finished=true, QUEUED — false', async () => {
    const created = await deployments.create(ownerId, workspaceId, dto());
    for (const status of ['SUCCESS', 'FAILED', 'INTERRUPTED'] as const) {
      await prisma.deployment.update({
        where: { id: created.id },
        data: { status, activeConfigId: null },
      });
      expect((await deployments.logs(ownerId, created.id)).finished).toBe(true);
    }
    await prisma.deployment.update({
      where: { id: created.id },
      data: { status: 'QUEUED', activeConfigId: configId },
    });
    expect((await deployments.logs(ownerId, created.id)).finished).toBe(false);
  });

  test('ответ — ровно контракт: ни cipher, ни snapshot, ни чужих полей БД', async () => {
    const res = await deployments.create(ownerId, workspaceId, dto());
    expect(Object.keys(res).sort()).toEqual([
      'commitSha',
      'configId',
      'containerId',
      'createdAt',
      'durationMs',
      'errorCode',
      'exitCode',
      'finishedAt',
      'id',
      'imageTag',
      'projectId',
      'startedAt',
      'status',
      'step',
      'triggeredById',
    ]);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});

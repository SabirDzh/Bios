import {
  BadRequestException,
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
import { DeployConfigsService } from './deploy-configs.service';
import type { CreateDeployConfigDto } from './dto/create-deploy-config.dto';
import { ProjectsService } from './projects.service';

// Отдельная база: jest гоняет спеки в параллельных воркерах, и два файла на одной
// базе мешают друг другу через afterEach/deleteMany. Тот же порядок, что у
// bios_test_servers / bios_test_docker в частях 3–4.
const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy_configs?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('DeployConfigsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
  let configs: DeployConfigsService;
  let ownerId: string;
  let workspaceId: string;
  let projectId: string;
  let serverId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
    projects = new ProjectsService(prisma, workspaces);
    configs = new DeployConfigsService(prisma, workspaces, projects);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ownerId = (
      await users.create({
        username: `cfowner${n}`,
        email: `cfowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `cf-ws-${n}` })).id;
    projectId = (
      await projects.create(ownerId, workspaceId, {
        name: 'shop',
        repoUrl: 'https://github.com/octocat/Hello-World.git',
      })
    ).id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: `cf-srv-${n}`,
        host: '203.0.113.40',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    serverId = server.id;
  });

  afterEach(async () => {
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(
    overrides: Partial<CreateDeployConfigDto> = {},
  ): CreateDeployConfigDto {
    return {
      name: 'prod',
      method: 'GIT_PULL',
      ref: 'master',
      containerName: 'shop-web',
      serverId,
      ...overrides,
    };
  }

  test('create: dockerfile по умолчанию, пустые ports, поля на месте', async () => {
    const created = await configs.create(
      ownerId,
      workspaceId,
      projectId,
      dto(),
    );
    expect(created).toMatchObject({
      projectId,
      serverId,
      name: 'prod',
      method: 'GIT_PULL',
      ref: 'master',
      dockerfile: 'Dockerfile',
      containerName: 'shop-web',
      ports: [],
    });
  });

  test('create: ports сохраняются как заданы', async () => {
    const created = await configs.create(
      ownerId,
      workspaceId,
      projectId,
      dto({ ports: ['8080:80', '9000:443/tcp'] }),
    );
    expect(created.ports).toEqual(['8080:80', '9000:443/tcp']);
  });

  test('create: сервер из другого воркспейса — 404 и ни одной строки', async () => {
    const otherWs = await workspaces.create(ownerId, { name: 'cf-other' });
    const foreign = await prisma.server.create({
      data: {
        workspaceId: otherWs.id,
        name: 'elsewhere',
        host: '203.0.113.41',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    await expect(
      configs.create(
        ownerId,
        workspaceId,
        projectId,
        dto({ serverId: foreign.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.deployConfig.count()).toBe(0);
  });

  test('create: несуществующий serverId — тоже 404', async () => {
    await expect(
      configs.create(
        ownerId,
        workspaceId,
        projectId,
        dto({ serverId: '01912345-6789-7abc-aef0-1234567890ff' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('create: не-GIT_PULL метод — 400 с текстом про следующий срез', async () => {
    await expect(
      configs.create(
        ownerId,
        workspaceId,
        projectId,
        dto({ method: 'COMPOSE' as unknown as 'GIT_PULL' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('create: MEMBER — 403; дубль имени и дубль containerName — 409', async () => {
    const member = (
      await users.create({
        username: `cfmem${n}`,
        email: `cfmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: member, role: 'MEMBER' },
    });
    await expect(
      configs.create(member, workspaceId, projectId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await configs.create(ownerId, workspaceId, projectId, dto());
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({ ref: 'main' })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      configs.create(ownerId, workspaceId, projectId, dto({ name: 'staging' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('list: только конфигурации этого проекта', async () => {
    await configs.create(ownerId, workspaceId, projectId, dto());
    const other = await projects.create(ownerId, workspaceId, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    await configs.create(
      ownerId,
      workspaceId,
      other.id,
      dto({ containerName: 'blog-web' }),
    );
    const rows = await configs.findAll(ownerId, workspaceId, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].containerName).toBe('shop-web');
  });

  test('containerName уникален в пределах СЕРВЕРА, а не проекта', async () => {
    await configs.create(ownerId, workspaceId, projectId, dto());
    const blog = await projects.create(ownerId, workspaceId, {
      name: 'blog',
      repoUrl: 'https://github.com/octocat/Hello-World',
    });
    // другой проект, тот же сервер, то же имя контейнера: второй деплой сделал бы
    // `docker rm -f shop-web` и убил сервис первого проекта
    await expect(
      configs.create(ownerId, workspaceId, blog.id, dto({ name: 'prod-2' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.deployConfig.count()).toBe(1);

    // а на другом сервере то же имя — законно
    const second = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-2',
        host: '203.0.113.42',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: 'z'.repeat(64),
      },
    });
    const onOtherServer = await configs.create(
      ownerId,
      workspaceId,
      blog.id,
      dto({ name: 'prod-2', serverId: second.id }),
    );
    expect(onOtherServer.containerName).toBe('shop-web');
  });
});

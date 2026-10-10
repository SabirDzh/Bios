import { NotFoundException } from '@nestjs/common';
import { ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { TokensService } from '../../tokens/tokens.service';
import { SessionsService } from '../../sessions/sessions.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { testAppConfig } from '../../../config/testing/app-config.fixture';
import type { CreateServerDto } from '../dto/create-server.dto';
import { CredentialCryptoService } from '../credentials/credential-crypto.service';
import { FakeSshRunner } from '../ssh/fake-ssh.runner';
import { MEMBER_ROLES, ServersService } from '../servers.service';
import { DockerService } from './docker.service';

// Своя база: два спека с одной тестовой БД в параллельных jest-воркерах дерутся
// из-за afterEach-deleteMany (пройдено в части 3, часть 4 повторяет конвенцию).
const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_docker?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const LIST = [
  {
    Id: 'aaaa1111',
    Names: ['/web'],
    Image: 'nginx:1.27',
    ImageID: 'sha256:zz',
    State: 'running',
    Status: 'Up 2 hours',
    Created: 1700000000,
    Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
    Labels: { 'bios.project': 'shop' },
  },
  {
    Id: 'bbbb2222',
    Names: ['/worker'],
    Image: 'alpine:3.20',
    State: 'exited',
    Status: 'Exited (1) 5 minutes ago',
    Created: 1700000100,
    Ports: [],
    Labels: {},
  },
];

const INSPECT = {
  Id: 'bbbb2222',
  Name: '/worker',
  Created: '2026-10-01T00:00:00.000000000Z',
  State: {
    Status: 'exited',
    Running: false,
    StartedAt: '2026-10-01T00:00:01.500000000Z',
    ExitCode: 137,
    OOMKilled: true,
    RestartCount: 3,
    Health: { Status: 'unhealthy' },
  },
  Config: {
    Image: 'alpine:3.20',
    Cmd: ['sh', '-c', 'exit 1'],
    Labels: { a: 'b' },
  },
  HostConfig: {},
  NetworkSettings: {
    Ports: { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '9000' }] },
  },
};

describe('DockerService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let credentials: CredentialCryptoService;
  let ssh: FakeSshRunner;
  let servers: ServersService;
  let docker: DockerService;
  let ownerId: string;
  let workspaceId: string;
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
    credentials = new CredentialCryptoService(testAppConfig());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ssh = new FakeSshRunner();
    servers = new ServersService(
      prisma,
      workspaces,
      credentials,
      ssh,
      testAppConfig(),
    );
    docker = new DockerService(servers, ssh, testAppConfig());
    ownerId = (
      await users.create({
        username: `dkowner${n}`,
        email: `dkowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `dk-ws-${n}` })).id;
    const created = await servers.create(ownerId, workspaceId, dtoFor());
    serverId = created.id;
    // Принятый host key: без него loadForSsh не выпускает аутентифицированную сессию.
    await prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: `SHA256:${'A'.repeat(43)}` },
    });
  });

  afterEach(async () => {
    await ssh.closeMock();
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dtoFor(overrides: Partial<CreateServerDto> = {}): CreateServerDto {
    return {
      name: 'dk-1',
      host: '203.0.113.20',
      port: 22,
      sshUsername: 'deploy',
      authType: ServerAuthType.PASSWORD,
      sshPassword: 'sup3rsecret',
      ...overrides,
    };
  }

  test('список: только наши поля, имя безleading slash, createdAt из Created', async () => {
    ssh.dockerRoutes['/containers/json'] = LIST;
    const list = await docker.list(ownerId, workspaceId, serverId, true);
    expect(list).toEqual([
      {
        id: 'aaaa1111',
        name: 'web',
        image: 'nginx:1.27',
        state: 'running',
        status: 'Up 2 hours',
        createdAt: new Date(1700000000 * 1000).toISOString(),
        exitCode: null,
      },
      {
        id: 'bbbb2222',
        name: 'worker',
        image: 'alpine:3.20',
        state: 'exited',
        status: 'Exited (1) 5 minutes ago',
        createdAt: new Date(1700000100 * 1000).toISOString(),
        exitCode: 1,
      },
    ]);
  });

  test('all=true уходит демону в query, all=false — нет', async () => {
    ssh.dockerRoutes['/containers/json'] = LIST;
    await docker.list(ownerId, workspaceId, serverId, true);
    expect(ssh.dockerRequests).toEqual(['GET /containers/json?all=true']);
    await docker.list(ownerId, workspaceId, serverId, false);
    expect(ssh.dockerRequests[1]).toBe('GET /containers/json?all=false');
  });

  test('детали: health, restartCount, oomKilled, порты, labels, startedAt', async () => {
    ssh.dockerRoutes['/containers/bbbb2222/json'] = INSPECT;
    const one = await docker.details(
      ownerId,
      workspaceId,
      serverId,
      'bbbb2222',
    );
    expect(one).toMatchObject({
      id: 'bbbb2222',
      name: 'worker',
      image: 'alpine:3.20',
      state: 'exited',
      exitCode: 137,
      oomKilled: true,
      restartCount: 3,
      health: 'UNHEALTHY',
      labels: { a: 'b' },
      startedAt: '2026-10-01T00:00:01.500Z',
      command: 'sh -c exit 1',
    });
    expect(one.ports).toEqual([
      { ip: '0.0.0.0', privatePort: 8080, publicPort: 9000, type: 'tcp' },
    ]);
  });

  test('inspect без Health и без портов → NONE и пустой массив', async () => {
    ssh.dockerRoutes['/containers/aaaa1111/json'] = {
      Id: 'aaaa1111',
      Name: '/web',
      Created: '2026-10-01T00:00:00Z',
      State: {
        Status: 'running',
        Running: true,
        StartedAt: '2026-10-01T00:00:00Z',
        ExitCode: 0,
      },
      Config: { Image: 'nginx', Labels: {} },
    };
    const one = await docker.details(
      ownerId,
      workspaceId,
      serverId,
      'aaaa1111',
    );
    expect(one.health).toBe('NONE');
    expect(one.ports).toEqual([]);
    expect(one.exitCode).toBe(0);
  });

  test('контейнера нет (404 демона) → 404, а не 5xx', async () => {
    ssh.dockerRoutes = {};
    await expect(
      docker.details(ownerId, workspaceId, serverId, 'ghost'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('без принятого host key — 424 и в Docker не заходили', async () => {
    await prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: null },
    });
    ssh.dockerRoutes['/containers/json'] = LIST;
    await expect(
      docker.list(ownerId, workspaceId, serverId, true),
    ).rejects.toMatchObject({ status: 424 });
    expect(ssh.dockerRequests).toHaveLength(0);
  });

  test('чужой сервер → 404, канал не тронут', async () => {
    const intruder = (
      await users.create({
        username: `dkintruder${n}`,
        email: `dkintruder${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    const other = await workspaces.create(intruder, { name: 'dk-other' });
    ssh.dockerRoutes['/containers/json'] = LIST;
    await expect(
      docker.list(intruder, other.id, serverId, true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      docker.list(ownerId, other.id, serverId, true),
    ).rejects.toMatchObject({ status: 404 });
    expect(ssh.dockerRequests).toHaveLength(0);
  });

  test('docker отсутствует на хосте → 424 DOCKER_MISSING по stderr канала', async () => {
    ssh.dockerDialFailure = 'sh: docker: not found\n';
    ssh.dockerDialCode = 127;
    await expect(
      docker.list(ownerId, workspaceId, serverId, true),
    ).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'DOCKER_MISSING' },
    });
  });

  test('транспорт закрывается и на успехе, и на отказе', async () => {
    ssh.dockerRoutes['/containers/json'] = LIST;
    await docker.list(ownerId, workspaceId, serverId, true);
    expect(ssh.transportsOpened).toBe(1);
    expect(ssh.transportsClosed).toBe(1);

    ssh.dockerRoutes = {};
    await expect(
      docker.list(ownerId, workspaceId, serverId, true),
    ).rejects.toBeInstanceOf(Error);
    expect(ssh.transportsOpened).toBe(2);
    expect(ssh.transportsClosed).toBe(2);
  });

  test('зависший демон → 504 TIMEOUT, транспорт закрыт', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({ commandTimeoutMs: 40 }),
    );
    ssh.dockerHangPrefix = 'GET /containers/json';
    await expect(
      docker.list(ownerId, workspaceId, serverId, true),
    ).rejects.toMatchObject({
      status: 504,
      response: { errorCode: 'TIMEOUT' },
    });
    expect(ssh.transportsClosed).toBe(1);
  });

  test('демон ответил 500 → 424 DOCKER_UNREACHABLE, не 5xx панели', async () => {
    ssh.dockerStatus['/containers/json'] = 500;
    await expect(
      docker.list(ownerId, workspaceId, serverId, true),
    ).rejects.toMatchObject({
      status: 424,
      response: { errorCode: 'DOCKER_UNREACHABLE' },
    });
  });

  test('список берёт дедлайн из ssh.commandTimeoutMs и не читает БД повторно', async () => {
    ssh.dockerRoutes['/containers/json'] = LIST;
    await docker.list(ownerId, workspaceId, serverId, true);
    expect(ssh.transportDeadlineMs).toEqual([1500]);
  });
});

describe('MEMBER_ROLES', () => {
  test('чтение контейнеров доступно роли из MEMBER_ROLES', () => {
    expect(Array.isArray(MEMBER_ROLES)).toBe(true);
    expect(MEMBER_ROLES.length).toBeGreaterThan(0);
  });
});

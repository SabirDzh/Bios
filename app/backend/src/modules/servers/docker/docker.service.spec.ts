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

// Фикстура stats — дословный ответ живого демона 28.3.2 (замер в плане, P1-B):
// system_cpu_usage и online_cpus живут ВНУТРИ cpu_stats/precpu_stats, а blkio
// даёт по записи на устройство.
const LIVE_STATS = {
  read: '2026-10-10T14:17:52.066724461Z',
  preread: '2026-10-10T14:17:51.061630169Z',
  cpu_stats: {
    cpu_usage: {
      total_usage: 10249000,
      usage_in_kernelmode: 0,
      usage_in_usermode: 0,
    },
    system_cpu_usage: 74550000000,
    online_cpus: 4,
    throttling_data: {},
  },
  precpu_stats: {
    cpu_usage: { total_usage: 10249000 },
    system_cpu_usage: 70540000000,
    online_cpus: 4,
  },
  memory_stats: { usage: 2260992, limit: 4110372864, stats: {} },
  blkio_stats: {
    io_service_bytes_recursive: [
      { major: 254, minor: 0, op: 'read', value: 1523712 },
      { major: 254, minor: 0, op: 'write', value: 0 },
      { major: 254, minor: 16, op: 'read', value: 147456 },
    ],
  },
  networks: { eth0: { rx_bytes: 1878, tx_bytes: 126 } },
};

describe('DockerService', () => {
  /** Кадр мультиплексированного потока: [тип][3 нуля][длина BE32][тело]. */
  function frame(stream: 1 | 2, text: string): Buffer {
    const body = Buffer.from(text, 'utf8');
    const out = Buffer.alloc(8 + body.length);
    out.writeUInt8(stream, 0);
    out.writeUInt32BE(body.length, 4);
    body.copy(out, 8);
    return out;
  }

  /** Tty берётся из inspect — двойник обязан отдать его до чтения логов. */
  function setTty(tty: boolean): void {
    ssh.dockerRoutes['/containers/web/json'] = { Config: { Tty: tty } };
  }

  function requestWith(substring: string): string {
    const hit = ssh.dockerRequests.find((r) => r.includes(substring));
    if (!hit) {
      throw new Error(
        `нет запроса с «${substring}», были: ${ssh.dockerRequests.join(', ')}`,
      );
    }
    return hit;
  }

  /** Участник без OWNER: restart обязан давать 403 именно на роли. */
  async function inviteMember(email: string): Promise<string> {
    const invitation = await workspaces.invite(ownerId, workspaceId, email);
    const user = await users.create({
      username: email.split('@')[0],
      email,
      password: 'secret123',
    });
    await workspaces.accept(user.id, workspaceId, invitation.token);
    return user.id;
  }

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

  test('логи: порядок stdout/stderr сохраняется по фреймам', async () => {
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = Buffer.concat([
      // Первым кадром идёт stderr — именно так поток приходит с демона. Порядок
      // обязан дойти до панели, а не «сначала весь stdout, потом весь stderr».
      frame(2, 'err-1\n'),
      frame(1, 'out-1\n'),
      frame(2, 'err-2\n'),
    ]);
    const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    expect(logs).toEqual({
      containerId: 'web',
      tty: false,
      lines: [
        { stream: 'stderr', text: 'err-1' },
        { stream: 'stdout', text: 'out-1' },
        { stream: 'stderr', text: 'err-2' },
      ],
      truncated: false,
      limitBytes: 262144,
    });
  });

  test('логи: при tty заголовков нет — голые байты идут в stdout', async () => {
    setTty(true);
    ssh.dockerRawBodies['/containers/web/logs'] =
      Buffer.from('tty-out\r\ntty-2\n');
    const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    expect(logs.tty).toBe(true);
    expect(logs.lines).toEqual([
      { stream: 'stdout', text: 'tty-out' },
      { stream: 'stdout', text: 'tty-2' },
    ]);
  });

  test('логи: один кадр с несколькими строками разбирается построчно', async () => {
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = frame(1, 'a\nb\nc\n');
    const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    expect(logs.lines.map((line) => line.text)).toEqual(['a', 'b', 'c']);
  });

  test('логи: бюджет общий на оба потока и считается в байтах UTF-8', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({}, { logsMaxBytes: 64 }),
    );
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = Buffer.concat([
      frame(1, 'привет-привет-привет\n'), // UTF-8 вдвое длиннее, чем .length
      frame(2, `${'x'.repeat(200)}\n`),
    ]);
    const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    const bytes = logs.lines.reduce(
      (acc, line) => acc + Buffer.byteLength(line.text, 'utf8'),
      0,
    );
    expect(logs.truncated).toBe(true);
    expect(bytes).toBeLessThanOrEqual(64);
  });

  test('логи: при переборе бюджета остаётся хвост, а не начало', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({}, { logsMaxBytes: 8 }),
    );
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = Buffer.concat([
      frame(1, 'aaaa\n'),
      frame(1, 'bbbb\n'),
      frame(1, 'cccc\n'),
    ]);
    const logs = await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    expect(logs.lines.map((line) => line.text)).toEqual(['bbbb', 'cccc']);
    expect(logs.truncated).toBe(true);
  });

  test('логи: tail, timestamps, stdout и stderr уходят демону в query', async () => {
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = frame(1, 'a\nb\nc\n');
    await docker.logs(ownerId, workspaceId, serverId, 'web', {
      tail: 2,
      timestamps: 'true',
    });
    const request = requestWith('containers/web/logs');
    expect(request).toContain('tail=2');
    expect(request).toContain('timestamps=true');
    expect(request).toContain('stdout=1');
    expect(request).toContain('stderr=1');
  });

  test('логи: tail по умолчанию 200, inspect и logs идут на одном транспорте', async () => {
    setTty(false);
    ssh.dockerRawBodies['/containers/web/logs'] = frame(1, 'a\n');
    await docker.logs(ownerId, workspaceId, serverId, 'web', {});
    expect(requestWith('containers/web/logs')).toContain('tail=200');
    // inspect + logs = два вызова демона, один SSH-коннект.
    expect(ssh.transportsOpened).toBe(1);
    expect(ssh.transportsClosed).toBe(1);
  });

  test('логи: контейнера нет → 404 на inspect, логов не запрашивали', async () => {
    await expect(
      docker.logs(ownerId, workspaceId, serverId, 'ghost', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ssh.dockerRequests.some((r) => r.includes('/logs'))).toBe(false);
  });

  test('логи: зависший демон прерывается дедлайном и закрывает транспорт', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({ commandTimeoutMs: 40 }),
    );
    setTty(false);
    ssh.dockerHangPrefix = 'GET /containers/web/logs';
    await expect(
      docker.logs(ownerId, workspaceId, serverId, 'web', {}),
    ).rejects.toMatchObject({
      status: 504,
      response: { errorCode: 'TIMEOUT' },
    });
    expect(ssh.transportsClosed).toBe(1);
  });

  test('stats: живая структура — cpuPercent null у спящего, блоки суммируются', async () => {
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify(LIVE_STATS),
    );
    const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
    expect(stats).toEqual({
      containerId: 'web',
      readAt: '2026-10-10T14:17:52.066Z',
      // У спящего контейнера cpuDelta = 0 (измерено) — это «нет данных», а не 0%.
      cpuPercent: null,
      memoryUsageBytes: 2260992,
      memoryLimitBytes: 4110372864,
      netRxBytes: 1878,
      netTxBytes: 126,
      blkReadBytes: 1671168, // 1523712 + 147456: по записи на устройство
      blkWriteBytes: 0,
    });
  });

  test('stats: ненулевая дельта и online_cpus=2 дают 200%', async () => {
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify({
        read: '2026-10-10T14:17:52.066724461Z',
        cpu_stats: {
          cpu_usage: { total_usage: 3000 },
          system_cpu_usage: 2500,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 2000 },
          system_cpu_usage: 1500,
          online_cpus: 2,
        },
        memory_stats: {},
      }),
    );
    const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
    // Дельта контейнера = дельта хоста → одну CPU-секунду на 2 доступных CPU.
    expect(stats.cpuPercent).toBe(200);
    expect(stats.memoryUsageBytes).toBeNull();
  });

  test('stats: перcpu без online_cpus и без percpu_usage → нет данных, а не 1 CPU', async () => {
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify({
        read: '2026-10-10T14:17:52.066724461Z',
        cpu_stats: {
          cpu_usage: { total_usage: 3000 },
          system_cpu_usage: 2000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 2000 },
          system_cpu_usage: 1500,
        },
      }),
    );
    const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
    expect(stats.cpuPercent).toBeNull();
  });

  test('stats: пустой ответ демона → null во всех полях, NaN нигде', async () => {
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify({ cpu_stats: {}, memory_stats: {} }),
    );
    const stats = await docker.stats(ownerId, workspaceId, serverId, 'web');
    expect(stats).toEqual({
      containerId: 'web',
      readAt: null,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      netRxBytes: null,
      netTxBytes: null,
      blkReadBytes: null,
      blkWriteBytes: null,
    });
  });

  test('stats: дедлайн берётся из cfg.docker.statsTimeoutMs', async () => {
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify(LIVE_STATS),
    );
    await docker.stats(ownerId, workspaceId, serverId, 'web');
    expect(ssh.transportDeadlineMs).toEqual([900]);
    expect(requestWith('containers/web/stats')).toContain('stream=false');
  });

  test('stats: зависший демон прерывается дедлайном и закрывает транспорт', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({}, { statsTimeoutMs: 40 }),
    );
    ssh.dockerHangPrefix = 'GET /containers/web/stats';
    await expect(
      docker.stats(ownerId, workspaceId, serverId, 'web'),
    ).rejects.toMatchObject({
      status: 504,
      response: { errorCode: 'TIMEOUT' },
    });
    expect(ssh.transportsClosed).toBe(1);
  });

  test('restart: POST /restart c t=1, состояние и запуска из инспекта', async () => {
    ssh.dockerRoutes['/containers/web/json'] = {
      Id: 'web',
      Name: '/web',
      State: {
        Status: 'running',
        StartedAt: '2026-10-10T00:00:00.000000000Z',
      },
      Config: { Image: 'alpine:3.20' },
    };
    ssh.dockerStatus['/containers/web/restart'] = 204;
    const res = await docker.act(ownerId, workspaceId, serverId, 'web', {
      action: 'restart',
    });
    expect(res).toEqual({
      containerId: 'web',
      action: 'restart',
      state: 'running',
      startedAt: '2026-10-10T00:00:00.000Z',
    });
    expect(requestWith('POST /containers/web/restart')).toContain('t=1');
  });

  test('restart: дедлайн из ssh.commandTimeoutMs, транспорт закрыт', async () => {
    ssh.dockerRoutes['/containers/web/json'] = {
      Id: 'web',
      State: { Status: 'running', StartedAt: '2026-10-10T00:00:00Z' },
    };
    ssh.dockerStatus['/containers/web/restart'] = 204;
    await docker.act(ownerId, workspaceId, serverId, 'web', {
      action: 'restart',
    });
    expect(ssh.transportDeadlineMs).toEqual([1500]);
    expect(ssh.transportsClosed).toBe(1);
  });

  test('restart: завис на stop — 504 TIMEOUT, а не 500 и не вечный запрос', async () => {
    docker = new DockerService(
      servers,
      ssh,
      testAppConfig({ commandTimeoutMs: 40 }),
    );
    ssh.dockerStatus['/containers/web/restart'] = 204;
    ssh.dockerHangPrefix = 'POST /containers/web/restart';
    await expect(
      docker.act(ownerId, workspaceId, serverId, 'web', { action: 'restart' }),
    ).rejects.toMatchObject({
      status: 504,
      response: { errorCode: 'TIMEOUT' },
    });
    expect(ssh.transportsClosed).toBe(1);
  });

  test('restart: участнику не-OWNER — 403, демон не получил ни одного вызова', async () => {
    const memberId = await inviteMember(`dk-member${n}@example.com`);
    ssh.dockerRoutes['/containers/web/json'] = { Id: 'web' };
    ssh.dockerStatus['/containers/web/restart'] = 204;
    await expect(
      docker.act(memberId, workspaceId, serverId, 'web', { action: 'restart' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(ssh.dockerRequests).toHaveLength(0);
  });

  test('restart: контейнера нет → 404 от демона, inspect не врёт', async () => {
    await expect(
      docker.act(ownerId, workspaceId, serverId, 'ghost', {
        action: 'restart',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('MEMBER_ROLES', () => {
  test('чтение контейнеров доступно роли из MEMBER_ROLES', () => {
    expect(Array.isArray(MEMBER_ROLES)).toBe(true);
    expect(MEMBER_ROLES.length).toBeGreaterThan(0);
  });
});

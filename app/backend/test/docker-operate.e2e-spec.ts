import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

// Своя тестовая БД: два e2e-спека с одной базой дерутся из-за afterEach-deleteMany.
// loadAppConfig() читает окружение при импорте app-config.module.ts, поэтому env
// задаются ДО require модулей приложения (импорты хойстятся и не подойдут).
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL =
  'postgresql://sabir@localhost:5432/bios_test_docker?schema=public';
process.env.NODE_ENV = 'development';
process.env.EMAIL_VERIFY_MX = 'false';
process.env.THROTTLE_SSH_OPS_LIMIT = '100';
process.env.THROTTLE_DOCKER_READS_LIMIT = '300';
process.env.THROTTLE_AUTH_STRICT_LIMIT = '50';
process.env.SSH_ALLOWED_PORTS = '22,2202';
process.env.SSH_ALLOW_LOOPBACK = 'true';
process.env.SERVER_CRYPTO_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SERVER_CRYPTO_KEY_ID = 'k1';

const { AppModule } =
  require('../src/app.module') as typeof import('../src/app.module');
const { AllExceptionsFilter } =
  require('../src/common/filters/all-exceptions.filter') as typeof import('../src/common/filters/all-exceptions.filter');
const { SSH_RUNNER } =
  require('../src/modules/servers/ssh/ssh-runner') as typeof import('../src/modules/servers/ssh/ssh-runner');
const { FakeSshRunner } =
  require('../src/modules/servers/ssh/fake-ssh.runner') as typeof import('../src/modules/servers/ssh/fake-ssh.runner');
const { PrismaService } =
  require('../src/database/prisma/prisma.service') as typeof import('../src/database/prisma/prisma.service');
const { ACCESS_COOKIE_NAME } =
  require('../src/modules/auth/auth-cookies') as typeof import('../src/modules/auth/auth-cookies');

const LIST = [
  {
    Id: 'aaaa1111',
    Names: ['/web'],
    Image: 'nginx:1.27',
    ImageID: 'sha256:zz',
    Platform: 'linux',
    State: 'running',
    Status: 'Up 2 hours',
    Created: 1700000000,
    Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
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
  Config: { Image: 'alpine:3.20', Cmd: ['sh', '-c', 'exit 1'], Labels: {} },
  NetworkSettings: { Ports: {} },
};

const STATS = {
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
  memory_stats: { usage: 552960, limit: 1048576 },
  networks: { eth0: { rx_bytes: 111, tx_bytes: 222 } },
  blkio_stats: {
    io_service_bytes_recursive: [
      { major: 254, minor: 0, op: 'read', value: 4096 },
      { major: 254, minor: 16, op: 'read', value: 1024 },
      { major: 254, minor: 0, op: 'write', value: 512 },
    ],
  },
};

/** Кадр мультиплексированного потока логов: [тип][3 нуля][длина BE32][тело]. */
function frame(stream: 1 | 2, text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt8(stream, 0);
  out.writeUInt32BE(body.length, 4);
  body.copy(out, 8);
  return out;
}

describe('docker operate e2e (cookies + fake docker api)', () => {
  let app: INestApplication<App>;
  let prisma: InstanceType<typeof PrismaService>;
  let ssh: InstanceType<typeof FakeSshRunner>;

  function idOf(res: { body: unknown }): string {
    return (res.body as { id: string }).id;
  }

  async function loginAs(email: string, username: string): Promise<string[]> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, email, password: 'secret123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);
    const cookies = login.get('set-cookie') as unknown as string[];
    expect(cookies.join(';')).toContain(ACCESS_COOKIE_NAME);
    return cookies;
  }

  /**
   * Сервер с принятым host key: путь «probe → подтверждение» уже проверен в
   * servers.e2e-spec, здесь он нас только тормозил бы — пин ставим прямо в БД.
   */
  async function pinnedServer(
    email: string,
    username: string,
    host: string,
  ): Promise<{
    cookies: string[];
    base: string;
    workspaceId: string;
    serverId: string;
  }> {
    const cookies = await loginAs(email, username);
    const ws = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Cookie', cookies)
      .send({ name: `dk-${username}` })
      .expect(201);
    const workspaceId = idOf(ws);
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: `${username}-1`,
        host,
        sshUsername: 'deploy',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    await prisma.server.update({
      where: { id: idOf(created) },
      data: { hostKeyFingerprint: `SHA256:${'A'.repeat(43)}` },
    });
    return {
      cookies,
      base: `/api/v1/workspaces/${workspaceId}/servers/${idOf(created)}/docker`,
      workspaceId,
      serverId: idOf(created),
    };
  }

  beforeAll(async () => {
    ssh = new FakeSshRunner();
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SSH_RUNNER)
      .useValue(ssh)
      .compile();

    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
    await ssh.closeMock();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    ssh.reset();
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

  test('список: только поля панели, без ImageID и Platform', async () => {
    const { cookies, base } = await pinnedServer(
      'dk-list@example.com',
      'dklist',
      '203.0.113.30',
    );
    ssh.dockerRoutes['/containers/json'] = LIST;
    const res = await request(app.getHttpServer())
      .get(`${base}/containers`)
      .set('Cookie', cookies)
      .expect(200);
    const rows = res.body as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 'aaaa1111',
      name: 'web',
      image: 'nginx:1.27',
      state: 'running',
      status: 'Up 2 hours',
      createdAt: new Date(1700000000 * 1000).toISOString(),
      exitCode: null,
    });
    expect(JSON.stringify(rows)).not.toContain('sha256:zz');
    expect(JSON.stringify(rows)).not.toContain('linux');
    expect(ssh.dockerRequests).toContain('GET /containers/json?all=false');
  });

  test('детали: health и restartCount из inspect', async () => {
    const { cookies, base } = await pinnedServer(
      'dk-details@example.com',
      'dkdetails',
      '203.0.113.31',
    );
    ssh.dockerRoutes['/containers/bbbb2222/json'] = INSPECT;
    const res = await request(app.getHttpServer())
      .get(`${base}/containers/bbbb2222`)
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body).toMatchObject({
      id: 'bbbb2222',
      health: 'UNHEALTHY',
      restartCount: 3,
      oomKilled: true,
      exitCode: 137,
    });
  });

  test('логи: байты заголовков не утекают в ответ', async () => {
    const { cookies, base } = await pinnedServer(
      'dk-logs@example.com',
      'dklogs',
      '203.0.113.32',
    );
    ssh.dockerRoutes['/containers/web/json'] = { Config: { Tty: false } };
    ssh.dockerRawBodies['/containers/web/logs'] = Buffer.concat([
      frame(2, 'err-1\n'),
      frame(1, 'out-1\n'),
    ]);
    const res = await request(app.getHttpServer())
      .get(`${base}/containers/web/logs?tail=2&timestamps=true`)
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body).toMatchObject({
      containerId: 'web',
      tty: false,
      truncated: false,
      lines: [
        { stream: 'stderr', text: 'err-1' },
        { stream: 'stdout', text: 'out-1' },
      ],
    });
    // Байты заголовка кадра (0x01/0x02) не должны просачиваться в текст строк.
    const text = (res.body as { lines: { text: string }[] }).lines
      .map((line) => line.text)
      .join('');
    expect(text.includes('\u0001')).toBe(false);
    expect(text.includes('\u0002')).toBe(false);
    expect(requestOf('containers/web/logs')).toContain('tail=2');
    expect(requestOf('containers/web/logs')).toContain('timestamps=true');
  });

  test('stats: проценты и байты из живой структуры ответа', async () => {
    const { cookies, base } = await pinnedServer(
      'dk-stats@example.com',
      'dkstats',
      '203.0.113.33',
    );
    ssh.dockerRawBodies['/containers/web/stats'] = Buffer.from(
      JSON.stringify(STATS),
    );
    const res = await request(app.getHttpServer())
      .get(`${base}/containers/web/stats`)
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body).toEqual({
      containerId: 'web',
      readAt: '2026-10-10T14:17:52.066Z',
      cpuPercent: 200,
      memoryUsageBytes: 552960,
      memoryLimitBytes: 1048576,
      netRxBytes: 111,
      netTxBytes: 222,
      blkReadBytes: 5120,
      blkWriteBytes: 512,
    });
  });

  test('restart: OWNER получает состояние из inspect, MEMBER — 403', async () => {
    const owner = await pinnedServer(
      'dk-restart@example.com',
      'dkrestart',
      '203.0.113.34',
    );
    const { workspaceId } = owner;
    ssh.dockerRoutes['/containers/web/json'] = {
      Id: 'web',
      State: { Status: 'running', StartedAt: '2026-10-10T00:00:00Z' },
    };
    ssh.dockerStatus['/containers/web/restart'] = 204;
    const res = await request(app.getHttpServer())
      .patch(`${owner.base}/containers/web`)
      .set('Cookie', owner.cookies)
      .send({ action: 'restart' })
      .expect(200);
    expect(res.body).toEqual({
      containerId: 'web',
      action: 'restart',
      state: 'running',
      startedAt: '2026-10-10T00:00:00.000Z',
    });
    expect(requestOf('POST /containers/web/restart')).toContain('t=1');

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: 'dkmember',
        email: 'dk-member@example.com',
        password: 'secret123',
      })
      .expect(201);
    const member = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dk-member@example.com', password: 'secret123' })
      .expect(200);
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: (
          await prisma.user.findUniqueOrThrow({
            where: { email: 'dk-member@example.com' },
            select: { id: true },
          })
        ).id,
        role: 'MEMBER',
      },
    });
    const forbidden = await request(app.getHttpServer())
      .patch(`${owner.base}/containers/web`)
      .set('Cookie', member.get('set-cookie') as unknown as string[])
      .send({ action: 'restart' })
      .expect(403);
    expect(forbidden.body).toMatchObject({ statusCode: 403 });
  });

  test('restart: не-restart тело даёт 400 и не доходит до демона', async () => {
    const { cookies, base } = await pinnedServer(
      'dk-badact@example.com',
      'dkbadact',
      '203.0.113.35',
    );
    await request(app.getHttpServer())
      .patch(`${base}/containers/web`)
      .set('Cookie', cookies)
      .send({ action: 'stop' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${base}/containers/web`)
      .set('Cookie', cookies)
      .send({})
      .expect(400);
    expect(ssh.dockerRequests.filter((r) => r.includes('/restart'))).toEqual(
      [],
    );
  });

  test('без принятого host key — 424 на всех пяти методах, демон не тронут', async () => {
    const { cookies, base, serverId } = await pinnedServer(
      'dk-nopin@example.com',
      'dknopin',
      '203.0.113.36',
    );
    await prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: null },
    });
    ssh.dockerRoutes['/containers/json'] = LIST;
    ssh.dockerRoutes['/containers/web/json'] = INSPECT;
    await request(app.getHttpServer())
      .get(`${base}/containers`)
      .set('Cookie', cookies)
      .expect(424);
    await request(app.getHttpServer())
      .get(`${base}/containers/web`)
      .set('Cookie', cookies)
      .expect(424);
    await request(app.getHttpServer())
      .get(`${base}/containers/web/logs`)
      .set('Cookie', cookies)
      .expect(424);
    await request(app.getHttpServer())
      .get(`${base}/containers/web/stats`)
      .set('Cookie', cookies)
      .expect(424);
    const patch = await request(app.getHttpServer())
      .patch(`${base}/containers/web`)
      .set('Cookie', cookies)
      .send({ action: 'restart' })
      .expect(424);
    expect(patch.body).toMatchObject({ errorCode: 'HOST_KEY_NOT_TRUSTED' });
    expect(ssh.dockerRequests).toHaveLength(0);
  });

  test('containerId вне whitelist и битый serverId — 400 до транспорта', async () => {
    const { cookies, base, workspaceId } = await pinnedServer(
      'dk-path@example.com',
      'dkpath',
      '203.0.113.37',
    );
    for (const bad of ['../../etc/passwd', 'a%2eb%2e/', 'a/b', '.hidden']) {
      await request(app.getHttpServer())
        .get(`${base}/containers/${encodeURIComponent(bad)}`)
        .set('Cookie', cookies)
        .expect(400);
    }
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceId}/servers/not-a-uuid/docker/containers`,
      )
      .set('Cookie', cookies)
      .expect(400);
    expect(ssh.dockerRequests).toHaveLength(0);
  });

  test('без куки — 401 на всех пяти маршрутах', async () => {
    const ws = '01912345-6789-7abc-aef0-1234567890ab';
    const sv = '01912345-6789-7abc-aef0-1234567890ac';
    const base = `/api/v1/workspaces/${ws}/servers/${sv}/docker`;
    await request(app.getHttpServer()).get(`${base}/containers`).expect(401);
    await request(app.getHttpServer())
      .get(`${base}/containers/web`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`${base}/containers/web/logs`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`${base}/containers/web/stats`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${base}/containers/web`)
      .send({ action: 'restart' })
      .expect(401);
  });

  function requestOf(substring: string): string {
    const hit = ssh.dockerRequests.find((r) => r.includes(substring));
    if (!hit) {
      throw new Error(
        `нет запроса с «${substring}», были: ${ssh.dockerRequests.join(', ')}`,
      );
    }
    return hit;
  }
});

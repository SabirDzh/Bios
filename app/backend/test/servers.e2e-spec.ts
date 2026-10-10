import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

// loadAppConfig() выполняется при импорте app-config.module.ts, поэтому env
// задаются ДО require модулей приложения (import-ы хойстятся и не подойдут).
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL =
  'postgresql://sabir@localhost:5432/bios_test_servers?schema=public';
process.env.NODE_ENV = 'development';
process.env.EMAIL_VERIFY_MX = 'false';
process.env.THROTTLE_SSH_OPS_LIMIT = '100';
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

describe('servers e2e (cookies + fake ssh)', () => {
  let app: INestApplication<App>;
  let prisma: InstanceType<typeof PrismaService>;
  let ssh: InstanceType<typeof FakeSshRunner>;

  /** Тело ответа supertest типизирован unknown: id нужен в URL — достаем явно. */
  function idOf(res: { body: unknown }): string {
    return (res.body as { id: string }).id;
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
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // Двойник живёт один прогон: команды и зарекаенные ответы прошлого теста
    // иначе просачиваются в следующий.
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

  async function loginAs(email: string, username: string): Promise<string[]> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, email, password: 'secret123' })
      .expect(201);
    // login отдаёт 200 (HttpCode на контроллере), а не 201
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);
    const cookies = login.get('set-cookie') as unknown as string[];
    expect(cookies.join(';')).toContain(ACCESS_COOKIE_NAME);
    return cookies;
  }

  async function newWorkspace(email: string, username: string) {
    const cookies = await loginAs(email, username);
    const ws = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Cookie', cookies)
      .send({ name: `e2e-${username}` })
      .expect(201);
    return { cookies, workspaceId: idOf(ws) };
  }

  const observed = `SHA256:${'C'.repeat(43)}`;
  const notInstalled =
    'SD=ok\nMF=absent\nJSON=-\nUNIT=no-unit\nHB=-\nNOW=1700000000\n';

  test('полный путь: server → probe host key → подтверждение → test → install → agent', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-owner@example.com',
      'e2eowner',
    );
    const serversUrl = `/api/v1/workspaces/${workspaceId}/servers`;

    const created = await request(app.getHttpServer())
      .post(serversUrl)
      .set('Cookie', cookies)
      .send({
        name: 'e2e-1',
        host: '203.0.113.20',
        sshUsername: 'deploy',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      hostKeyFingerprint: null,
      port: 22,
    });
    expect(created.body).not.toHaveProperty('secretCipher');
    expect(created.body).not.toHaveProperty('sshPassword');
    const url = `${serversUrl}/${idOf(created)}`;

    ssh.hostKey(/.*/, observed, 'HOST_KEY_NOT_TRUSTED');
    const probe = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(200);
    expect(probe.body).toMatchObject({
      reachable: false,
      trustRequired: true,
      hostKeyFingerprint: observed,
      errorCode: 'HOST_KEY_NOT_TRUSTED',
    });

    // Подтверждение с ЧУЖИМ отпечатком не принимается и пин не пишет.
    // Ответ probe нужно зарекаить заново: предыдущий уже израсходован.
    ssh.hostKey(/.*/, observed, 'HOST_KEY_NOT_TRUSTED');
    await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({ trustHostKey: `SHA256:${'D'.repeat(43)}` })
      .expect(409);

    ssh.hostKey(/.*/, observed, 'HOST_KEY_NOT_TRUSTED');
    ssh.respond(/docker version/, '27.3.1\n');
    const confirmed = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({ trustHostKey: observed })
      .expect(200);
    expect(confirmed.body).toMatchObject({
      reachable: true,
      status: 'ONLINE',
      dockerVersion: '27.3.1',
    });

    const active = `SD=ok\nMF=present\nJSON={"version":"0.1.0","workspaceId":"${workspaceId}","serverId":"${idOf(created)}"}\nUNIT=active\nHB=1699999990\nNOW=1699999995\n`;
    ssh.respond(/systemctl is-active/, notInstalled);
    ssh.respond(/systemctl daemon-reload/, '');
    ssh.respond(/systemctl is-active/, active);
    const installed = await request(app.getHttpServer())
      .post(`${url}/agent/install`)
      .set('Cookie', cookies)
      .expect(201);
    expect(installed.body).toMatchObject({
      outcome: 'INSTALLED',
      agent: { status: 'ACTIVE' },
    });

    ssh.respond(/systemctl is-active/, active);
    const agentStatus = await request(app.getHttpServer())
      .get(`${url}/agent`)
      .set('Cookie', cookies)
      .expect(200);
    expect(agentStatus.body).toMatchObject({
      status: 'ACTIVE',
      version: '0.1.0',
      errorCode: null,
    });
    expect(ssh.commands.join('\n')).not.toContain('sup3rsecret');

    const details = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      hostKeyFingerprint: observed,
      lastAgentStatus: 'ACTIVE',
    });
  });

  test('install без подтверждённого host key → 424, креденшелы не отправлялись', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-nopin@example.com',
      'e2enopin',
    );
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: 'np',
        host: '203.0.113.24',
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceId}/servers/${idOf(created)}/agent/install`,
      )
      .set('Cookie', cookies)
      .expect(424);
    expect(res.body).toMatchObject({
      statusCode: 424,
      errorCode: 'HOST_KEY_NOT_TRUSTED',
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('метаданные облака блокируются политикой: test даёт 424 TARGET_BLOCKED', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-ssrf@example.com',
      'e2essrf',
    );
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: 'meta',
        host: '169.254.169.254',
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers/${idOf(created)}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(424);
    expect(res.body).toMatchObject({
      statusCode: 424,
      errorCode: 'TARGET_BLOCKED',
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('порт вне allowlist → 400 на создании', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-port@example.com',
      'e2eport',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: 'p',
        host: '203.0.113.25',
        port: 23,
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(400);
  });

  test('недостижимый хост: test 200 reachable:false, install 424', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-down@example.com',
      'e2edown',
    );
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: 'down',
        host: '203.0.113.21',
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    await prisma.server.update({
      where: { id: idOf(created) },
      data: { hostKeyFingerprint: observed },
    });
    const url = `/api/v1/workspaces/${workspaceId}/servers/${idOf(created)}`;

    const e = new Error('connect ECONNREFUSED 203.0.113.21:22') as Error & {
      code?: string;
    };
    e.code = 'ECONNREFUSED';
    ssh.fail(/docker version/, e);
    const probe = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set('Cookie', cookies)
      .send({})
      .expect(200);
    expect(probe.body).toMatchObject({
      reachable: false,
      status: 'OFFLINE',
      errorCode: 'REFUSED',
    });

    ssh.fail(/systemctl is-active/, e);
    const install = await request(app.getHttpServer())
      .post(`${url}/agent/install`)
      .set('Cookie', cookies)
      .expect(424);
    expect(install.body).toMatchObject({
      statusCode: 424,
      errorCode: 'REFUSED',
    });
  });

  test('без куки — 401 на все шесть роутов', async () => {
    const base =
      '/api/v1/workspaces/01912345-6789-7abc-aef0-1234567890ab/servers';
    const sv = '01912345-6789-7abc-aef0-1234567890ac';
    await request(app.getHttpServer()).post(base).send({}).expect(401);
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).get(`${base}/${sv}`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/${sv}/test`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base}/${sv}/agent/install`)
      .expect(401);
    await request(app.getHttpServer()).get(`${base}/${sv}/agent`).expect(401);
  });

  test('валидация до БД: креденшел не по authType, лишний authType, битый host, битый uuid', async () => {
    const { cookies, workspaceId } = await newWorkspace(
      'e2e-third@example.com',
      'e2ethird',
    );
    const url = `/api/v1/workspaces/${workspaceId}/servers`;

    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({
        name: 'x',
        host: '203.0.113.22',
        sshUsername: 'deploy',
        authType: 'PASSWORD',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({
        name: 'x',
        host: '203.0.113.22',
        sshUsername: 'deploy',
        authType: 'AGENT',
        sshPassword: 'secret1234',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookies)
      .send({
        name: 'x',
        host: 'a; rm -rf /',
        sshUsername: 'deploy',
        authType: 'PASSWORD',
        sshPassword: 'secret1234',
      })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/servers/not-a-uuid`)
      .set('Cookie', cookies)
      .expect(400);
    expect(await prisma.server.count({ where: { workspaceId } })).toBe(0);
  });

  test('чужой сервер и чужой workspace — 404, секрет наружу не утекает', async () => {
    const a = await newWorkspace('e2e-owner2@example.com', 'e2eowner2');
    const b = await newWorkspace('e2e-other@example.com', 'e2eother');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${a.workspaceId}/servers`)
      .set('Cookie', a.cookies)
      .send({
        name: 'secret-1',
        host: '203.0.113.23',
        sshUsername: 'deploy',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${b.workspaceId}/servers/${idOf(created)}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${a.workspaceId}/servers/${idOf(created)}`)
      .set('Cookie', b.cookies)
      .expect(404);
    const visible = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${a.workspaceId}/servers/${idOf(created)}`)
      .set('Cookie', a.cookies)
      .expect(200);
    expect(JSON.stringify(visible.body)).not.toContain('sup3rsecret');
  });
});

import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy?schema=public';
process.env.NODE_ENV = 'development';
process.env.EMAIL_VERIFY_MX = 'false';
// Поиск: заведомо закрытый порт — e2e не зависит от локального Meilisearch.
process.env.MEILI_HOST = 'http://127.0.0.1:9';
process.env.THROTTLE_SSH_OPS_LIMIT = '100';
process.env.THROTTLE_AUTH_STRICT_LIMIT = '50';
process.env.SSH_ALLOWED_PORTS = '22,2202';
process.env.SSH_ALLOW_LOOPBACK = 'true';
process.env.DEPLOY_STEP_TIMEOUT_MS = '5000';
process.env.DEPLOY_HOST_LOG_BYTES = '65536';
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
const { DeployRunnerService } =
  require('../src/modules/deployments/deploy-runner.service') as typeof import('../src/modules/deployments/deploy-runner.service');
const { DeploymentsController } =
  require('../src/modules/deployments/deployments.controller') as typeof import('../src/modules/deployments/deployments.controller');
const { THROTTLE_PROFILE_KEY } =
  require('../src/common/throttle/throttle-profile.decorator') as typeof import('../src/common/throttle/throttle-profile.decorator');

const PIN = `SHA256:${'A'.repeat(43)}`;

function stepOut(step: string, markers: string[] = [], log = 'ok'): string {
  return [
    `BIOS_STEP=${step}`,
    'BIOS_RC=0',
    ...markers,
    'BIOS_LOG_BEGIN',
    log,
    'BIOS_LOG_END',
  ].join('\n');
}

describe('deploy core e2e (cookies + fake ssh)', () => {
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

  let serverOrdinal = 0;

  /**
   * Всё, что нужно до деплоя: воркспейс → сервер (пин прямо в БД, TOFU проверен
   * в servers.e2e-spec) → проект → конфигурация. Возвращает id'ы и куки.
   */
  async function onboard(
    email: string,
    username: string,
    pin: string | null = PIN,
  ) {
    const cookies = await loginAs(email, username);
    const ws = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Cookie', cookies)
      .send({ name: `dp-${username}` })
      .expect(201);
    const workspaceId = idOf(ws);
    serverOrdinal += 1;
    const server = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/servers`)
      .set('Cookie', cookies)
      .send({
        name: `${username}-host`,
        host: `203.0.113.${49 + serverOrdinal}`,
        sshUsername: 'root',
        authType: 'PASSWORD',
        sshPassword: 'sup3rsecret',
      })
      .expect(201);
    if (pin !== null) {
      await prisma.server.update({
        where: { id: idOf(server) },
        data: { hostKeyFingerprint: pin },
      });
    }
    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Cookie', cookies)
      .send({
        name: `${username}-shop`,
        repoUrl: 'https://github.com/octocat/hello-world.git',
      })
      .expect(201);
    const config = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceId}/projects/${idOf(project)}/deploy-configs`,
      )
      .set('Cookie', cookies)
      .send({
        name: 'prod',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: `${username}-web`,
        ports: ['8080:80'],
        serverId: idOf(server),
      })
      .expect(201);
    return {
      cookies,
      workspaceId,
      serverId: idOf(server),
      projectId: idOf(project),
      configId: idOf(config),
    };
  }

  function scriptHappyPath(): void {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(
      /source\.log/,
      stepOut('source', ['BIOS_SHA=7fd1a60'], 'Cloning into'),
    );
    ssh.respond(
      /build\.log/,
      stepOut('build', ['BIOS_IMAGE=sha256:aaa'], 'naming to image'),
    );
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=c0ffee'], 'c0ffee'));
  }

  async function settle(): Promise<void> {
    await app.get(DeployRunnerService).drain();
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

  test('полный путь: 202 → QUEUED, drain → SUCCESS, журнал из четырёх разделов, история и логи', async () => {
    const ctx = await onboard('dp-full@example.com', 'dpfull');
    scriptHappyPath();

    const queued = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    const deploymentId = idOf(queued);
    // Единственное детерминированное доказательство «202 раньше исполнения»: тело
    // сформировано из строки в статусе QUEUED. Ассерт `ssh.commands.length === 0`
    // здесь был бы гонкой: tick() стартует микрозадачей.
    expect(queued.body).toMatchObject({ status: 'QUEUED', step: null });

    await settle();

    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${deploymentId}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      id: deploymentId,
      status: 'SUCCESS',
      step: 'run',
      commitSha: '7fd1a60',
      containerId: 'c0ffee',
      errorCode: null,
    });
    expect(details.body.imageTag).toBe(`bios-deploy:${deploymentId}`);

    const logs = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${deploymentId}/logs`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(logs.body.finished).toBe(true);
    for (const step of ['preflight', 'source', 'build', 'run']) {
      expect(logs.body.log).toContain(`===== ${step} =====`);
    }
    expect(logs.body.sizeBytes).toBe(
      Buffer.byteLength(logs.body.log as string, 'utf8'),
    );

    const history = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      id: deploymentId,
      status: 'SUCCESS',
    });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(list.body[0]).toMatchObject({ id: ctx.projectId });
    const configs = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
      )
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(configs.body[0]).toMatchObject({
      id: ctx.configId,
      ports: ['8080:80'],
      method: 'GIT_PULL',
    });
    ssh.assertNoSecretLeak('sup3rsecret');
  });

  test('граница DTO отклоняет до записи в БД: credentials, http, git-синтаксис, абсолютный путь, порт 0, чужое поле, чужой метод', async () => {
    const ctx = await onboard('dp-bad@example.com', 'dpbad');
    const badProjects: Record<string, unknown>[] = [
      { name: 'x', repoUrl: 'https://user:token@github.com/a/b.git' },
      { name: 'y', repoUrl: 'http://github.com/a/b' },
      { name: 'z', repoUrl: 'git@github.com:a/b.git' },
      { name: 'w', repoUrl: 'https://169.254.169.254/latest/meta-data' },
    ];
    for (const body of badProjects) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
        .set('Cookie', ctx.cookies)
        .send(body)
        .expect(400);
    }

    const badConfigs: Record<string, unknown>[] = [
      {
        name: 'c1',
        method: 'GIT_PULL',
        ref: 'main^',
        containerName: 'c1',
        serverId: ctx.serverId,
      },
      {
        name: 'c2',
        method: 'GIT_PULL',
        ref: 'master',
        dockerfile: '../Dockerfile',
        containerName: 'c2',
        serverId: ctx.serverId,
      },
      {
        name: 'c3',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'c3',
        serverId: ctx.serverId,
        ports: ['0:80'],
      },
      {
        name: 'c4',
        method: 'COMPOSE',
        ref: 'master',
        containerName: 'c4',
        serverId: ctx.serverId,
      },
      {
        name: 'c5',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'c5',
        serverId: ctx.serverId,
        extra: 1,
      },
      {
        name: 'c6',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: '-c6',
        serverId: ctx.serverId,
      },
    ];
    for (const body of badConfigs) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
        )
        .set('Cookie', ctx.cookies)
        .send(body)
        .expect(400);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: 'not-a-uuid' })
      .expect(400);

    // ни одного лишнего проекта и ни одной лишней конфигурации
    expect(
      await prisma.project.count({ where: { workspaceId: ctx.workspaceId } }),
    ).toBe(1);
    expect(
      await prisma.deployConfig.count({ where: { projectId: ctx.projectId } }),
    ).toBe(1);
  });

  test('роли: MEMBER не создаёт ничего, но читает историю; без куки — 401', async () => {
    const ctx = await onboard('dp-owner@example.com', 'dpowner');
    scriptHappyPath();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    // Приглашения — часть 2; участника заводим напрямую в БД, чтобы деплой-спек
    // не тек вместе с механизмом инвайтов.
    const memberCookies = await loginAs('dp-member@example.com', 'dpmem');
    const memberRow = await prisma.user.findFirstOrThrow({
      where: { email: 'dp-member@example.com' },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: memberRow.id,
        role: 'MEMBER',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', memberCookies)
      .send({
        name: 'mem-shop',
        repoUrl: 'https://github.com/octocat/Hello-World',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
      )
      .set('Cookie', memberCookies)
      .send({
        name: 'mem',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'mem-web',
        serverId: ctx.serverId,
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', memberCookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', memberCookies)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(created)}`)
      .set('Cookie', memberCookies)
      .expect(200);

    for (const path of [
      `/api/v1/workspaces/${ctx.workspaceId}/projects`,
      `/api/v1/workspaces/${ctx.workspaceId}/deployments`,
      `/api/v1/deployments/${idOf(created)}`,
      `/api/v1/deployments/${idOf(created)}/logs`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(401);
  });

  test('чужие id — 404 на обоих концах: проект из другого воркспейса и чужой деплой', async () => {
    const a = await onboard('dp-a@example.com', 'dpa');
    const b = await onboard('dp-b@example.com', 'dpb');

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${b.workspaceId}/projects/${a.projectId}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${b.workspaceId}/deployments`)
      .set('Cookie', b.cookies)
      .send({ projectId: a.projectId, configId: a.configId })
      .expect(404);
    // проверяем isolation на НАСТОЯЩЕМ деплое: 404 на несуществующем объекте
    // ничего не доказывает
    scriptHappyPath();
    const foreign = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${a.workspaceId}/deployments`)
      .set('Cookie', a.cookies)
      .send({ projectId: a.projectId, configId: a.configId })
      .expect(202);
    await settle();
    expect(
      (
        await prisma.deployment.findUniqueOrThrow({
          where: { id: idOf(foreign) },
        })
      ).status,
    ).toBe('SUCCESS');

    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(foreign)}`)
      .set('Cookie', b.cookies)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(foreign)}/logs`)
      .set('Cookie', b.cookies)
      .expect(404);
    // конфигурация чужого проекта под своим проектом — тоже 404
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${b.workspaceId}/deployments`)
      .set('Cookie', b.cookies)
      .send({ projectId: b.projectId, configId: a.configId })
      .expect(404);
  });

  test('дубли: имя проекта и containerName конфигурации — 409', async () => {
    const ctx = await onboard('dp-dup@example.com', 'dpdup');
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/projects`)
      .set('Cookie', ctx.cookies)
      .send({
        name: 'dpdup-shop',
        repoUrl: 'https://github.com/octocat/Hello-World',
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${ctx.workspaceId}/projects/${ctx.projectId}/deploy-configs`,
      )
      .set('Cookie', ctx.cookies)
      .send({
        name: 'other',
        method: 'GIT_PULL',
        ref: 'master',
        containerName: 'dpdup-web',
        serverId: ctx.serverId,
      })
      .expect(409);
  });

  test('очередь на уровне HTTP: активная задача той же конфигурации — 409, после освобождения слота — 202', async () => {
    const ctx = await onboard('dp-queue@example.com', 'dpqueue');
    const ownerRow = await prisma.user.findFirstOrThrow({
      where: { email: 'dp-queue@example.com' },
    });
    // Слот занимаем вставкой, а не исполнителем: «одна активная задача» —
    // свойство unique-индекса (Task 1), и тест не должен зависеть от того,
    // успел ли in-process исполнитель дойти до finalize.
    await prisma.deployment.create({
      data: {
        projectId: ctx.projectId,
        configId: ctx.configId,
        triggeredById: ownerRow.id,
        activeConfigId: ctx.configId,
      },
    });

    const conflict = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(409);
    expect(conflict.body).toMatchObject({ statusCode: 409 });
    expect(await prisma.deployment.count()).toBe(1);
    // исполнитель не вызывался: 409 рождается на вставке
    expect(ssh.commands).toHaveLength(0);

    await prisma.deployment.deleteMany({});
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(1);
  });

  test('провал шага не становится ошибкой HTTP: 202, а задача FAILED с диагнозом', async () => {
    const ctx = await onboard('dp-fail@example.com', 'dpfail');
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(
      /build\.log/,
      `BIOS_STEP=build\nBIOS_RC=53\nBIOS_LOG_BEGIN\ndockerfile parse error\nBIOS_LOG_END`,
      { code: 53 },
    );
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      status: 'FAILED',
      step: 'build',
      errorCode: 'BUILD_FAILED',
      exitCode: 53,
    });
    // шаг run не исполнялся
    expect(ssh.commands).toHaveLength(3);
    const logs = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}/logs`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(logs.body).toMatchObject({ finished: true, status: 'FAILED' });
    expect(logs.body.log).toContain('dockerfile parse error');
  });

  test('незапиненный хост: 202 без единого SSH-соединения, задача HOST_KEY_NOT_TRUSTED', async () => {
    const ctx = await onboard('dp-nopin@example.com', 'dpnopin', null);
    scriptHappyPath();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    expect(ssh.commands).toHaveLength(0);
    expect(ssh.sessions).toHaveLength(0);
    const details = await request(app.getHttpServer())
      .get(`/api/v1/deployments/${idOf(res)}`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(details.body).toMatchObject({
      status: 'FAILED',
      errorCode: 'HOST_KEY_NOT_TRUSTED',
      step: null,
    });
  });

  test('query: limit=abc|0|000|101 — 400, limit=1 — одна запись, фильтры работают', async () => {
    const ctx = await onboard('dp-query@example.com', 'dpquery');
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();
    // слот освободил сам finalize SUCCESS — второй POST это и проверяет
    scriptHappyPath();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${ctx.workspaceId}/deployments`)
      .set('Cookie', ctx.cookies)
      .send({ projectId: ctx.projectId, configId: ctx.configId })
      .expect(202);
    await settle();

    for (const bad of ['abc', '0', '000', '101']) {
      await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${ctx.workspaceId}/deployments?limit=${bad}`,
        )
        .set('Cookie', ctx.cookies)
        .expect(400);
    }
    const limited = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${ctx.workspaceId}/deployments?limit=1`)
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(limited.body).toHaveLength(1);
    const filtered = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${ctx.workspaceId}/deployments?configId=${ctx.configId}&projectId=${ctx.projectId}`,
      )
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(filtered.body).toHaveLength(2);
    const wrongProject = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${ctx.workspaceId}/deployments?projectId=${ctx.serverId}`,
      )
      .set('Cookie', ctx.cookies)
      .expect(200);
    expect(wrongProject.body).toEqual([]);
  });

  test('POST /deployments получает профиль sshOps, чтения остаются на global', () => {
    expect(
      Reflect.getMetadata(
        THROTTLE_PROFILE_KEY,
        DeploymentsController.prototype.create,
      ),
    ).toBe('sshOps');
    expect(
      Reflect.getMetadata(
        THROTTLE_PROFILE_KEY,
        DeploymentsController.prototype.list,
      ),
    ).toBeUndefined();
  });
});

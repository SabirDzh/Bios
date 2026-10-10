import { DeployMethod, Prisma, ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CredentialCryptoService } from '../servers/credentials/credential-crypto.service';
import { ServersService } from '../servers/servers.service';
import { FakeSshRunner } from '../servers/ssh/fake-ssh.runner';
import { SshFailure } from '../servers/ssh/ssh-runner';
import { testAppConfig } from '../../config/testing/app-config.fixture';
import { DeployRunnerService } from './deploy-runner.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy_runner?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

const PIN = 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET = 'sup3rsecret';

function shqTest(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('waitFor: условие не наступило');
    await new Promise((r) => setImmediate(r));
  }
}

/** Хвост шага в том виде, в котором его печатает обёртка из Task 5. */
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

function failOut(step: string, rc: number, log: string): string {
  return [
    `BIOS_STEP=${step}`,
    `BIOS_RC=${rc}`,
    'BIOS_LOG_BEGIN',
    log,
    'BIOS_LOG_END',
  ].join('\n');
}

describe('DeployRunnerService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let servers: ServersService;
  let ssh: FakeSshRunner;
  let runner: DeployRunnerService;
  let ownerId: string;
  let workspaceId: string;
  let serverId: string;
  let projectId: string;
  let configId: string;
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
    ssh = new FakeSshRunner();
    const credentials = new CredentialCryptoService(testAppConfig());
    servers = new ServersService(
      prisma,
      workspaces,
      credentials,
      ssh,
      testAppConfig(),
    );
    runner = new DeployRunnerService(
      prisma,
      servers,
      ssh,
      testAppConfig({}, {}, { rootDir: '/tmp/bios-deploy' }),
    );
    ownerId = (
      await users.create({
        username: `drun${n}`,
        email: `drun${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `drun-ws-${n}` }))
      .id;
    const server = await prisma.server.create({
      data: {
        workspaceId,
        name: 'host-1',
        host: '203.0.113.21',
        port: 22,
        sshUsername: 'deploy',
        authType: ServerAuthType.PASSWORD,
        secretCipher: credentials.encrypt(SECRET),
        hostKeyFingerprint: PIN,
      },
    });
    serverId = server.id;
    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: 'shop',
        repoUrl: 'https://github.com/octocat/hello-world.git',
      },
    });
    projectId = project.id;
    const config = await prisma.deployConfig.create({
      data: {
        projectId,
        serverId,
        name: 'prod',
        method: DeployMethod.GIT_PULL,
        ref: 'master',
        containerName: 'shop-web',
        ports: ['8080:80'],
      },
    });
    configId = config.id;
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

  /**
   * Очередь наполняется напрямую через Prisma: `activeConfigId` — это контракт
   * схемы (Task 1), а способ его занять тестирует Task 7 своим набором тестов.
   */
  const snapshot = {
    method: 'GIT_PULL',
    ref: 'master',
    dockerfile: 'Dockerfile',
    containerName: 'shop-web',
    ports: ['8080:80'],
    repoUrl: 'https://github.com/octocat/hello-world.git',
  };

  async function enqueue(
    overrides: Partial<Prisma.DeploymentUncheckedCreateInput> = {},
  ) {
    return prisma.deployment.create({
      data: {
        projectId,
        configId,
        triggeredById: ownerId,
        activeConfigId: configId,
        snapshot,
        ...overrides,
      },
    });
  }

  /** Ещё одна конфигурация того же проекта: для теста очередей и параллелизма. */
  async function otherConfig(): Promise<string> {
    const row = await prisma.deployConfig.create({
      data: {
        projectId,
        serverId,
        name: 'staging',
        method: DeployMethod.GIT_PULL,
        ref: 'master',
        containerName: 'shop-staging',
      },
    });
    return row.id;
  }

  function scriptHappyPath(): void {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(
      /source\.log/,
      stepOut('source', ['BIOS_SHA=7fd1a60'], 'Cloning into'),
    );
    ssh.respond(
      /build\.log/,
      stepOut('build', ['BIOS_IMAGE=sha256:aaa111'], 'naming to docker.io'),
    );
    ssh.respond(
      /run\.log/,
      stepOut('run', ['BIOS_CID=c0ffee1234'], 'c0ffee1234'),
    );
  }

  test('успешный проход: четыре шага по порядку, SUCCESS и все значения из маркеров', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'SUCCESS',
      step: 'RUN',
      commitSha: '7fd1a60',
      imageTag: `bios-deploy:${job.id}`,
      containerId: 'c0ffee1234',
      errorCode: null,
      exitCode: null,
      activeConfigId: null,
    });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);

    // порядок шагов виден по именам лог-файлов в командах
    expect(ssh.commands).toHaveLength(4);
    expect(
      ['preflight', 'source', 'build', 'run'].map((s) =>
        ssh.commands.findIndex((c) => c.includes(`${s}.log`)),
      ),
    ).toEqual([0, 1, 2, 3]);

    for (const step of ['preflight', 'source', 'build', 'run']) {
      expect(row.log.indexOf(`===== ${step} =====`)).toBeGreaterThan(-1);
    }
    expect(row.log.indexOf('===== source =====')).toBeLessThan(
      row.log.indexOf('===== build ====='),
    );
    expect(row.log).toContain('Cloning into');

    expect(ssh.probes).toHaveLength(0);
    expect(ssh.sessions).toHaveLength(4);
    // каждый шаг — аутентифицированная сессия с запиненным отпечатком
    expect(
      ssh.sessions.every((s) => s.expectedHostKeyFingerprint === PIN),
    ).toBe(true);
    ssh.assertNoSecretLeak(SECRET);
  });

  test('дедлайн шага берётся из deploy.stepTimeoutMs, а не из ssh.commandTimeoutMs', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    // фикстура ставит 2000 там, где ssh.commandTimeoutMs = 1500: совпадение
    // значений сделало бы этот тест нечитаемым
    expect(ssh.execTimeoutMs).toEqual([2000, 2000, 2000, 2000]);
    expect(testAppConfig().ssh.commandTimeoutMs).not.toBe(2000);
  });

  test('claim атомарен: повторный и параллельный запуск дают один набор команд', async () => {
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    expect(ssh.commands).toHaveLength(4);

    await runner.run(job.id);
    expect(ssh.commands).toHaveLength(4);

    const second = await enqueue();
    scriptHappyPath();
    await Promise.all([runner.run(job.id), runner.run(second.id)]);
    // 8 = два разных деплоя, а не две попытки одного
    expect(ssh.commands).toHaveLength(8);
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(2);
  });

  test('остановка на первом неуспехе: build RC=53 → шага run нет, диагноз с хвостом', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(
      /build\.log/,
      failOut('build', 53, 'error: dockerfile parse error'),
      { code: 53 },
    );
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      step: 'BUILD',
      errorCode: 'BUILD_FAILED',
      exitCode: 53,
      commitSha: '7fd1a60',
      containerId: null,
      activeConfigId: null,
    });
    expect(ssh.commands).toHaveLength(3);
    expect(row.log).toContain('dockerfile parse error');
  });

  test('git на хосте нет → preflight срывает деплой до source', async () => {
    ssh.respond(/preflight\.log/, failOut('preflight', 50, 'BIOS_ERR_GIT'), {
      code: 50,
    });
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'GIT_MISSING',
      exitCode: 50,
    });
    expect(ssh.commands).toHaveLength(1);
  });

  test('код 0 без подтверждения шагом — COMMAND_FAILED, а не SUCCESS', async () => {
    // FakeSshRunner отдаёт ПЕРВЫЙ неиспользованный ответ по регулярке, поэтому
    // «без протокола» надо ставиться в очередь вместо build-ответа, а не после
    // него (scriptHappyPath уже занял /build\.log/).
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    ssh.respond(/build\.log/, 'все хорошо, без всякого протокола');
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=c0ffee1234']));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'COMMAND_FAILED',
      step: 'BUILD',
    });
    expect(ssh.commands).toHaveLength(3);
  });

  test('TIMEOUT шага → TIMEOUT, строка закрыта, слот освобождён', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.fail(
      /source\.log/,
      new SshFailure('TIMEOUT', 'ssh operation timed out'),
    );
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'TIMEOUT',
      activeConfigId: null,
    });
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  test('хост не принимает ключ → AUTH_FAILED на первом же шаге', async () => {
    ssh.fail(
      /preflight\.log/,
      new SshFailure('AUTH_FAILED', 'all authentication methods failed'),
    );
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'AUTH_FAILED',
      step: 'PREFLIGHT',
    });
  });

  test('порт закрыт → REFUSED, имя не разрешилось → DNS', async () => {
    for (const [code, expected] of [
      ['REFUSED', 'REFUSED'],
      ['DNS', 'DNS'],
    ] as const) {
      ssh.reset();
      ssh.fail(/preflight\.log/, new SshFailure(code, 'transport'));
      const job = await enqueue();
      await runner.run(job.id);
      const row = await prisma.deployment.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row).toMatchObject({ status: 'FAILED', errorCode: expected });
    }
  });

  test('неизвестный сбой канала → HOST_UNREACHABLE, а не COMMAND_FAILED', async () => {
    ssh.fail(/preflight\.log/, new SshFailure('NETWORK', 'transport'));
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'HOST_UNREACHABLE',
    });
  });

  test('host key не запинен → 424 из loadForSsh, ни одной удалённой команды', async () => {
    await prisma.server.update({
      where: { id: serverId },
      data: { hostKeyFingerprint: null },
    });
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'HOST_KEY_NOT_TRUSTED',
      step: null,
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('запустивший потерял доступ → ACCESS_LOST, ни одной удалённой команды', async () => {
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    scriptHappyPath();
    const job = await enqueue();
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'ACCESS_LOST',
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('неожиданная ошибка в середине цикла закрывает задачу и сохраняет прогресс', async () => {
    // сценарий: панель упала внутри своего кода — на третьем шаге зарекаенного
    // ответа нет, FakeSshRunner бросает обычный Error
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(/source\.log/, stepOut('source', ['BIOS_SHA=7fd1a60']));
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'COMMAND_FAILED',
      commitSha: '7fd1a60',
      activeConfigId: null,
    });
  });

  test('reconcile: сироты становятся INTERRUPTED, а слот конфигурации освобождается', async () => {
    const started = new Date(Date.now() - 45000);
    const running = await enqueue({
      status: 'RUNNING',
      startedAt: started,
      step: 'BUILD',
    });
    const queued = await enqueue({ activeConfigId: null, status: 'QUEUED' });
    // третья строка — уже завершённая: её трогать нельзя
    const done = await enqueue({
      status: 'SUCCESS',
      finishedAt: new Date(),
      activeConfigId: null,
    });

    expect(await runner.reconcile()).toBe(2);

    const r = await prisma.deployment.findUniqueOrThrow({
      where: { id: running.id },
    });
    expect(r).toMatchObject({
      status: 'INTERRUPTED',
      errorCode: 'PANEL_RESTARTED',
      activeConfigId: null,
    });
    expect(r.durationMs).not.toBeNull();
    expect(r.durationMs).toBeGreaterThanOrEqual(45000);
    expect(r.log).toContain('INTERRUPTED');

    const q = await prisma.deployment.findUniqueOrThrow({
      where: { id: queued.id },
    });
    // QUEUED не имел startedAt: длительность выдумывать нельзя
    expect(q).toMatchObject({ status: 'INTERRUPTED', durationMs: null });
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: done.id } }),
    ).toMatchObject({ status: 'SUCCESS' });

    // слот освобождён: следующая задача этой же конфигурации проходит по unique
    const next = await enqueue();
    expect(next.activeConfigId).toBe(configId);
  });

  test('план строится из snapshot, а не из живых полей конфигурации', async () => {
    scriptHappyPath();
    const job = await enqueue();
    // «правка» конфигурации между постановкой в очередь и стартом
    await prisma.deployConfig.update({
      where: { id: job.configId },
      data: {
        ref: 'develop',
        containerName: 'renamed-web',
        ports: ['9090:80'],
      },
    });
    await runner.run(job.id);

    expect(ssh.commands).toHaveLength(4);
    const source = ssh.commands[1];
    expect(source).toContain(shqTest('master'));
    expect(source).not.toContain(shqTest('develop'));
    const run = ssh.commands[3];
    expect(run).toContain(shqTest('shop-web'));
    expect(run).not.toContain(shqTest('renamed-web'));
    expect(run).toContain(shqTest('8080:80'));
    expect(run).not.toContain(shqTest('9090:80'));
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: 'SUCCESS' });
  });

  test('снимок не читается → SNAPSHOT_INVALID до первой удалённой команды', async () => {
    scriptHappyPath();
    const job = await enqueue({ snapshot: { ref: 'master' } });
    await runner.run(job.id);
    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'SNAPSHOT_INVALID',
    });
    expect(ssh.commands).toHaveLength(0);
  });

  test('поддельный BIOS_RC в хвосте лога не превращает провал в успех', async () => {
    ssh.respond(/preflight\.log/, stepOut('preflight'));
    ssh.respond(
      /source\.log/,
      stepOut('source', ['BIOS_SHA=' + 'a'.repeat(40)]),
    );
    // вывод docker build печатает в том числе текст Dockerfile: здесь в хвосте
    // лежит строка, похожая на успешный конверт
    ssh.respond(
      /build\.log/,
      'BIOS_STEP=build\nBIOS_RC=53\nBIOS_LOG_BEGIN\nBIOS_RC=0\nBIOS_STEP=build\nBIOS_LOG_END',
      { code: 53 },
    );
    ssh.respond(/run\.log/, stepOut('run', ['BIOS_CID=ffff']));
    const job = await enqueue();
    await runner.run(job.id);

    const row = await prisma.deployment.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'BUILD_FAILED',
      exitCode: 53,
    });
    // и до шага run дело не дошло
    expect(ssh.commands).toHaveLength(3);
  });

  test('maxParallel держит очередь: вторая задача не стартует, пока слот занят', async () => {
    // фикстура даёт maxParallel = 1; build-шаг первой задачи стоит на gate,
    // и мы видим промежуток, в котором вторая ОБЯЗАНА быть QUEUED
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = ssh.exec.bind(ssh);
    let builds = 0;
    ssh.exec = (session, command, timeoutMs) => {
      if (/build\.log/.test(command)) {
        builds += 1;
        return gate.then(() => inner(session, command, timeoutMs));
      }
      return inner(session, command, timeoutMs);
    };
    scriptHappyPath();
    scriptHappyPath();

    const first = await enqueue();
    const secondId = await otherConfig();
    const second = await enqueue({
      configId: secondId,
      activeConfigId: secondId,
    });

    runner.pump();
    await waitFor(() => builds > 0);

    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ status: 'RUNNING', step: 'BUILD' });
    expect(
      await prisma.deployment.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({ status: 'QUEUED', step: null });

    release();
    await runner.drain();

    expect(builds).toBe(2);
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(2);
  });

  test('maxParallel = 2 поднимает обе конфигурации одновременно', async () => {
    runner = new DeployRunnerService(
      prisma,
      servers,
      ssh,
      testAppConfig({}, {}, { maxParallel: 2 }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = ssh.exec.bind(ssh);
    const gated: string[] = [];
    ssh.exec = (session, command, timeoutMs) => {
      if (!/build\.log/.test(command))
        return inner(session, command, timeoutMs);
      gated.push(session.address);
      return gate.then(() => inner(session, command, timeoutMs));
    };
    scriptHappyPath();
    scriptHappyPath();
    const first = await enqueue();
    const other = await otherConfig();
    const second = await enqueue({ configId: other, activeConfigId: other });

    runner.pump();
    await waitFor(() => gated.length === 2);
    release();
    await runner.drain();

    expect(gated).toHaveLength(2);
    expect(
      await prisma.deployment.count({
        where: { status: 'SUCCESS', id: { in: [first.id, second.id] } },
      }),
    ).toBe(2);
  });

  test('pump() поднимает очередь сам и всё исполняется к drain()', async () => {
    scriptHappyPath();
    await enqueue();
    runner.pump();
    await runner.drain();
    expect(
      await prisma.deployment.count({ where: { status: 'SUCCESS' } }),
    ).toBe(1);
  });
});

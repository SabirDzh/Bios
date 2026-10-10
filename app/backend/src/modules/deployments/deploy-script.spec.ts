import {
  DEPLOY_EXIT_CODES,
  buildDeployPlan,
  deployCodeOfSsh,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  toPrismaStep,
  type DeployPlanInput,
  type DeployStepName,
  type StepResult,
} from './deploy-script';
import { toDeploySnapshot } from './deployment.types';

const PATHS = deployPaths('/opt/bios-deploy', 'proj-1', 'cfg-1');

function plan(
  overrides: Partial<DeployPlanInput> = {},
): ReturnType<typeof buildDeployPlan> {
  return buildDeployPlan({
    paths: PATHS,
    root: true,
    repoUrl: 'https://github.com/octocat/hello-world.git',
    ref: 'master',
    dockerfile: 'Dockerfile',
    imageTag: 'bios-deploy:01912345-6789-7abc-aef0-1234567890ff',
    containerName: 'shop-web',
    ports: ['8080:80', '9000:443/tcp'],
    logTailBytes: 4096,
    hostLogBytes: 65536,
    ...overrides,
  });
}

describe('buildDeployPlan', () => {
  test('всегда четыре шага в порядке preflight → source → build → run', () => {
    expect(plan().map((entry) => entry.step)).toEqual([
      'preflight',
      'source',
      'build',
      'run',
    ]);
  });

  test('каждый шаг печатает протокол и режет лог дважды: на хосте и в панель', () => {
    for (const entry of plan()) {
      expect(entry.command).toContain(
        `printf 'BIOS_STEP=%s\\n' '${entry.step}'`,
      );
      expect(entry.command).toContain('BIOS_RC=');
      expect(entry.command).toContain('BIOS_LOG_BEGIN');
      expect(entry.command).toContain('BIOS_LOG_END');
      // Замер (п.7): node-ssh копит весь stdout в памяти панели → хвост режем там.
      expect(entry.command).toContain('tail -c 4096');
      // И файл на хосте ограничен, иначе диск клиента растёт с каждой сборкой.
      expect(entry.command).toContain('tail -c 65536');
    }
  });

  test('шаг source проверяет ref без конвейера и хранит полный SHA', () => {
    const source = plan()[1].command;
    // `| grep -q .` вернул бы статус grep: сетевой отказ стал бы REF_NOT_FOUND
    expect(source).not.toContain('| grep');
    expect(source).toContain('ls-remote --heads --tags');
    expect(source).toContain(
      "> '/opt/bios-deploy/proj-1/cfg-1/logs/source.probe'",
    );
    expect(source).toContain(
      "[ -s '/opt/bios-deploy/proj-1/cfg-1/logs/source.probe' ]",
    );
    expect(source).toContain('rev-parse HEAD');
    expect(source).not.toContain('rev-parse --short');
  });

  test('значения с кавычками и подстановкой экранированы', () => {
    const joined = plan({
      repoUrl: 'https://github.com/a/$(touch /tmp/pwned).git',
      ref: 'main',
      containerName: 'c`id`',
    })
      .map((entry) => entry.command)
      .join('\n');
    expect(joined).toContain(`'https://github.com/a/$(touch /tmp/pwned).git'`);
    expect(joined).toContain("'c`id`'");
  });

  test('ports становятся серией -p, пустые — нулём флагов', () => {
    const run = plan()[3].command;
    expect(run).toContain(`-p '8080:80'`);
    expect(run).toContain(`-p '9000:443/tcp'`);
    // Проверять надо именно строку `docker run`: обёртка сама печатает
    // `mkdir -p '<logDir>'`, и ассерт по всей команде ловил бы её `-p`.
    const dockerRun = plan({ ports: [] })[3]
      .command.split('\n')
      .find((line) => line.includes('docker run'));
    expect(dockerRun).toBeDefined();
    expect(dockerRun).not.toContain('-p');
  });

  test('dockerfile в подкаталоге меняет контекст сборки', () => {
    const build = plan({ dockerfile: 'docker/Dockerfile.prod' })[2].command;
    expect(build).toContain(
      '--file ' + "'/opt/bios-deploy/proj-1/cfg-1/src/docker/Dockerfile.prod'",
    );
    expect(build).toContain("'/opt/bios-deploy/proj-1/cfg-1/src/docker'");
  });

  test('не-ROOT: каждый шаг целиком идёт через sudo -n, ROOT — никогда', () => {
    for (const entry of plan({ root: false })) {
      expect(entry.command).toContain('sudo -n sh -lc');
      // двойного sudo внутри тела быть не должно
      expect(entry.command.match(/sudo/g)).toHaveLength(1);
    }
    for (const entry of plan({ root: true })) {
      expect(entry.command).not.toContain('sudo');
    }
  });

  test('шаги работают под одним деревом: paths корень + /src и /logs', () => {
    expect(PATHS.srcDir).toBe('/opt/bios-deploy/proj-1/cfg-1/src');
    expect(PATHS.logDir).toBe('/opt/bios-deploy/proj-1/cfg-1/logs');
  });
});

describe('parseStepResult', () => {
  const stdout = [
    'BIOS_RC=0',
    'BIOS_SHA=7fd1a60',
    'BIOS_STEP=source',
    'BIOS_LOG_BEGIN',
    'Cloning into',
    'BIOS_LOG_END',
  ].join('\n');

  test('читает rc, маркеры значений и лог', () => {
    expect(parseStepResult(stdout, '', 0)).toEqual({
      code: 0,
      markers: { RC: '0', SHA: '7fd1a60', STEP: 'source' },
      log: 'Cloning into',
      protocolOk: true,
    });
  });

  test('терпит trim от node-ssh и пустой лог', () => {
    const parsed = parseStepResult(
      `  ${stdout.replace('Cloning into', '')}  `,
      '',
      0,
    );
    expect(parsed.markers.SHA).toBe('7fd1a60');
    expect(parsed.log).toBe('');
  });

  test('нет конверта — protocolOk=false, а не успешный шаг', () => {
    const broken = parseStepResult('всё хорошо', '', 0);
    expect(broken.markers).toEqual({});
    expect(broken.protocolOk).toBe(false);
  });

  test('BEGIN без END — тоже сломанный конверт', () => {
    expect(
      parseStepResult('BIOS_RC=0\nBIOS_LOG_BEGIN\nобрезало', '', 0).protocolOk,
    ).toBe(false);
  });

  test('stderr добавляется к логу: docker пишет диагноз именно туда', () => {
    const parsed = parseStepResult(stdout, 'permission denied', 1);
    expect(parsed.log).toContain('permission denied');
  });

  test('вывод сборки не может подделать протокол', () => {
    // `docker build` печатает в том числе текст Dockerfile; маркеры читаются
    // только из области до BIOS_LOG_BEGIN, поэтому эта строка — данные
    const spoofed = [
      'BIOS_STEP=build',
      'BIOS_RC=53',
      'BIOS_LOG_BEGIN',
      'BIOS_RC=0',
      'BIOS_SHA=deadbeef',
      'BIOS_CID=ffff',
      'BIOS_LOG_END',
    ].join('\n');
    const parsed = parseStepResult(spoofed, '', 53);
    expect(parsed.markers).toEqual({ STEP: 'build', RC: '53' });
    expect(parsed.log).toContain('BIOS_RC=0');
    expect(deployErrorCodeOf('build', parsed)).toBe('BUILD_FAILED');
  });
});

describe('deployErrorCodeOf', () => {
  const ok = (
    rc: number | null,
    step: DeployStepName,
    extra: Partial<StepResult> = {},
  ): StepResult => ({
    code: rc,
    markers: { ...(rc === null ? {} : { RC: String(rc) }), STEP: step },
    log: '',
    protocolOk: true,
    ...extra,
  });

  test('наши коды становятся диагнозами панели', () => {
    expect(
      deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.GIT, 'preflight')),
    ).toBe('GIT_MISSING');
    expect(
      deployErrorCodeOf('preflight', ok(DEPLOY_EXIT_CODES.DOCKER, 'preflight')),
    ).toBe('DOCKER_MISSING');
    expect(
      deployErrorCodeOf(
        'preflight',
        ok(DEPLOY_EXIT_CODES.DOCKER_PERM, 'preflight'),
      ),
    ).toBe('DOCKER_PERMISSION_DENIED');
    expect(
      deployErrorCodeOf(
        'preflight',
        ok(DEPLOY_EXIT_CODES.DOCKER_SOCKET, 'preflight'),
      ),
    ).toBe('DOCKER_SOCKET_UNREACHABLE');
    expect(
      deployErrorCodeOf('source', ok(DEPLOY_EXIT_CODES.REF, 'source')),
    ).toBe('REF_NOT_FOUND');
    expect(
      deployErrorCodeOf('build', ok(DEPLOY_EXIT_CODES.DOCKERFILE, 'build')),
    ).toBe('DOCKERFILE_MISSING');
    expect(
      deployErrorCodeOf(
        'source',
        ok(DEPLOY_EXIT_CODES.SOURCE, 'source', {
          log: 'fatal: repository not found',
        }),
      ),
    ).toBe('SOURCE_FAILED');
    expect(deployErrorCodeOf('build', ok(1, 'build'))).toBe('BUILD_FAILED');
    expect(deployErrorCodeOf('run', ok(125, 'run'))).toBe('RUN_FAILED');
  });

  test('успех без подтверждения шагом — COMMAND_FAILED, с подтверждением — null', () => {
    expect(deployErrorCodeOf('run', ok(0, 'run', { markers: {} }))).toBe(
      'COMMAND_FAILED',
    );
    expect(deployErrorCodeOf('run', ok(0, 'run'))).toBeNull();
  });

  test('нет конверта или нет RC — COMMAND_FAILED, код соединения сам по себе не довод', () => {
    expect(
      deployErrorCodeOf('source', ok(0, 'source', { protocolOk: false })),
    ).toBe('COMMAND_FAILED');
    expect(deployErrorCodeOf('source', ok(null, 'source'))).toBe(
      'COMMAND_FAILED',
    );
  });

  test('RC из конверта и код канала обязаны совпадать', () => {
    // обёртка делает `exit "$RC"`: расхождение значит, что конверт собран не ей
    expect(deployErrorCodeOf('build', ok(0, 'build', { code: 53 }))).toBe(
      'COMMAND_FAILED',
    );
    // code === null (шов не дал кода) при наличии RC — не противоречие, RC и так единственный источник
    expect(
      deployErrorCodeOf('build', ok(0, 'build', { code: null })),
    ).toBeNull();
  });
});

describe('toDeploySnapshot', () => {
  const valid = {
    method: 'GIT_PULL',
    ref: 'master',
    dockerfile: 'Dockerfile',
    containerName: 'shop-web',
    ports: ['8080:80'],
    repoUrl: 'https://github.com/octocat/hello-world.git',
  };

  test('читает то, что записал enqueue', () => {
    expect(toDeploySnapshot(valid)).toEqual(valid);
    expect(toDeploySnapshot({ ...valid, ports: [] })?.ports).toEqual([]);
  });

  test('null на мусоре: исполнитель не имеет права исполнять наугад', () => {
    expect(toDeploySnapshot(null)).toBeNull();
    expect(toDeploySnapshot('master')).toBeNull();
    expect(toDeploySnapshot([])).toBeNull();
    expect(toDeploySnapshot({ ...valid, ports: '8080:80' })).toBeNull();
    expect(toDeploySnapshot({ ...valid, ports: [1] })).toBeNull();
    expect(toDeploySnapshot({ ...valid, method: 'COMPOSE' })).toBeNull();
    expect(toDeploySnapshot({ ...valid, repoUrl: undefined })).toBeNull();
  });
});

describe('deployCodeOfSsh', () => {
  test('три кода шва имеют точный диагноз деплоя', () => {
    expect(deployCodeOfSsh('TIMEOUT')).toBe('TIMEOUT');
    expect(deployCodeOfSsh('HOST_KEY_NOT_TRUSTED')).toBe(
      'HOST_KEY_NOT_TRUSTED',
    );
    expect(deployCodeOfSsh('HOST_KEY_MISMATCH')).toBe('HOST_KEY_MISMATCH');
  });

  test('сетевые диагнозы различимы', () => {
    expect(deployCodeOfSsh('AUTH_FAILED')).toBe('AUTH_FAILED');
    expect(deployCodeOfSsh('REFUSED')).toBe('REFUSED');
    expect(deployCodeOfSsh('DNS')).toBe('DNS');
  });

  test('прочие детали транспорта сворачиваются в «хост недоступен»', () => {
    for (const code of [
      'NETWORK',
      'RESOLUTION_FAILED',
      'TARGET_BLOCKED',
      'PORT_NOT_ALLOWED',
      'HOST_KEY',
      'DOCKER_UNREACHABLE',
    ] as const) {
      expect(deployCodeOfSsh(code)).toBe('HOST_UNREACHABLE');
    }
  });
});

test('toPrismaStep: строчный протокол → enum БД', () => {
  expect(['preflight', 'source', 'build', 'run'].map(toPrismaStep)).toEqual([
    'PREFLIGHT',
    'SOURCE',
    'BUILD',
    'RUN',
  ]);
});

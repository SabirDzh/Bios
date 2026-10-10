import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDeployPlan,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  type DeployPlanInput,
  type DeployStepName,
  type StepResult,
} from './deploy-script';

const PWNED = '/tmp/bios-sandbox-pwned';
const PWNED2 = '/tmp/bios-sandbox-pwned2';

function stub(bin: string, name: string, body: string): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}`, { mode: 0o755 });
}

function runStep(
  command: string,
  bin: string,
  path = `${bin}:/usr/bin:/bin`,
): StepResult {
  // Код шага берётся ИЗ КОНВЕРТА (BIOS_RC), как это делает исполнитель: `mv -f`
  // и `tail` в обёртке выполняются после субшелла, и статус процесса-обёртки не
  // обязан совпадать с RC собранного шага.
  let stdout = '';
  try {
    stdout = execFileSync('/bin/sh', ['-c', command], {
      env: { ...process.env, PATH: path },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    stdout = typeof e.stdout === 'string' ? e.stdout : '';
    if (stdout === '') throw err; // команда умерла до того, как что-то напечатала
  }
  return parseStepResult(stdout, '', null);
}

function sandboxRoot(prefix: string): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  return { root, bin };
}

/**
 * PATH без системных каталогов: на этой машине `/usr/bin/git` существует
 * (замер), поэтому «git отсутствует» невозможно сыграть просто отсутствием
 * стабы — надо отрезать PATH. Coreutils в стабовую папку линкуемся, иначе
 * обёртка потеряет `mkdir`/`tail` и код 50 утонет в 127.
 */
function linkCoreutils(bin: string): string {
  for (const [name, target] of [
    ['mkdir', '/bin/mkdir'],
    ['cat', '/bin/cat'],
    ['mv', '/bin/mv'],
    ['tail', '/usr/bin/tail'],
  ] as const) {
    symlinkSync(target, join(bin, name));
  }
  return bin;
}

/**
 * Стаба git: `clone` обязан оставить то, что читатель плана ждёт от настоящего
 * clone — рабочий каталог с `.git` и Dockerfile внутри. Иначе шаг `build`
 * падает на DOCKERFILE_MISSING, и тест проверял бы не то.
 */
const GIT_STUB_CLONE = [
  'for a in "$@"; do case "$a" in */src)',
  '  mkdir -p "$a/.git"; printf "FROM scratch\\n" > "$a/Dockerfile" ;;',
  'esac; done',
].join('\n');

function input(
  root: string,
  overrides: Partial<DeployPlanInput> = {},
): DeployPlanInput {
  return {
    paths: deployPaths(join(root, 'deploy'), 'p1', 'c1'),
    root: true,
    repoUrl: 'https://github.com/octocat/hello-world.git',
    ref: 'master',
    dockerfile: 'Dockerfile',
    imageTag: 'bios-deploy:01912345-6789-7abc-aef0-1234567890ff',
    containerName: 'shop-web',
    ports: ['8080:80'],
    logTailBytes: 4096,
    hostLogBytes: 65536,
    ...overrides,
  };
}

/** 40-символьный SHA: `rev-parse HEAD`, а не `--short`. */
const FULL_SHA = '7fd1a60c093f60005fe24929fe1dcf68e0a7e5a0';

describe('deploy plan in a real shell', () => {
  beforeEach(() => {
    rmSync(PWNED, { force: true });
    rmSync(PWNED2, { force: true });
  });

  afterAll(() => {
    rmSync(PWNED, { force: true });
    rmSync(PWNED2, { force: true });
  });

  test('успешный план: значения приехали, лог на хосте ограничен, в панели хвост', () => {
    const { root, bin } = sandboxRoot('bios-deploy-');
    stub(
      bin,
      'git',
      [
        'if [ "$1" = "ls-remote" ]; then printf "abc123\\trefs/heads/master\\n"; exit 0; fi',
        GIT_STUB_CLONE,
        `if [ "$1" = "-C" ]; then printf "${FULL_SHA}\\n"; exit 0; fi`,
        'exit 0',
      ].join('\n'),
    );
    stub(
      bin,
      'docker',
      [
        'i=0; while [ $i -lt 20000 ]; do echo "layer line $i"; i=$((i+1)); done >&2',
        'printf "sha256:aaa111\\n"',
        'exit 0',
      ].join('\n'),
    );
    const plan = buildDeployPlan(input(root));
    const results = plan.map((entry) => runStep(entry.command, bin));
    expect(results.map((r) => r.markers.RC)).toEqual(['0', '0', '0', '0']);
    expect(
      results.map((r) =>
        deployErrorCodeOf(r.markers.STEP as DeployStepName, r),
      ),
    ).toEqual([null, null, null, null]);
    expect(results[1].markers.SHA).toBe(FULL_SHA);
    expect(results[1].markers.SHA).toHaveLength(40);
    expect(results[3].markers.CID).toBeTruthy();

    const logPath = join(root, 'deploy', 'p1', 'c1', 'logs', 'build.log');
    const host = readFileSync(logPath, 'utf8');
    // docker напечатал ~300 КБ; на хосте осталось не больше hostLogBytes
    expect(host.length).toBeLessThanOrEqual(65536);
    expect(host.length).toBeGreaterThan(60000);
    // а в панель приехал только logTailBytes
    expect(results[2].log.length).toBeLessThanOrEqual(4096);
    expect(existsSync(PWNED)).toBe(false);
  });

  test('значения с кавычками и подстановкой не исполняются ни на одном шаге', () => {
    const { root, bin } = sandboxRoot('bios-deploy-pwn-');
    stub(bin, 'git', 'exit 0\n');
    stub(bin, 'docker', 'exit 0\n');
    const plan = buildDeployPlan(
      input(root, {
        repoUrl: `https://x/$(touch ${PWNED}).git`,
        ref: 'main',
        containerName: 'c`touch ' + PWNED + '`',
      }),
    );
    plan.forEach((entry) => runStep(entry.command, bin));
    expect(existsSync(PWNED)).toBe(false);
    expect(existsSync(PWNED2)).toBe(false);
  });

  test('git отсутствует → preflight даёт RC=50 и диагностику GIT_MISSING', () => {
    const { root, bin } = sandboxRoot('bios-deploy-nogit-');
    stub(bin, 'docker', 'exit 0\n'); // git-стаба НЕТ
    // PATH только со стабой и линками coreutils: /usr/bin/git на этой машине
    // существует, и с системным PATH проверка «git нет» ничего бы не проверила.
    linkCoreutils(bin);
    const first = runStep(buildDeployPlan(input(root))[0].command, bin, bin);
    expect(first.markers.RC).toBe('50');
    expect(deployErrorCodeOf('preflight', first)).toBe('GIT_MISSING');
  });

  test('ls-remote отработал пусто → RC=51 и REF_NOT_FOUND', () => {
    const { root, bin } = sandboxRoot('bios-deploy-ref-');
    stub(bin, 'git', 'exit 0\n'); // ничего не печатает = 0 строк, код 0
    stub(bin, 'docker', 'exit 0\n');
    const second = runStep(buildDeployPlan(input(root))[1].command, bin);
    expect(second.markers.RC).toBe('51');
    expect(deployErrorCodeOf('source', second)).toBe('REF_NOT_FOUND');
  });

  test('ls-remote упал (сеть/TLS) → RC=52 и SOURCE_FAILED, а не REF_NOT_FOUND', () => {
    // без pipefail конвейер с grep отдавал статус grep, и сетевой отказ
    // выглядел как «ветки нет». Замер: `sh -c 'ls /no-such | grep -q .;
    // echo $?'` → 1 в обоих случаях.
    const { root, bin } = sandboxRoot('bios-deploy-netfail-');
    stub(
      bin,
      'git',
      'if [ "$1" = "ls-remote" ]; then echo "fatal: unable to access" >&2; exit 128; fi\nexit 0\n',
    );
    stub(bin, 'docker', 'exit 0\n');
    const second = runStep(buildDeployPlan(input(root))[1].command, bin);
    expect(second.markers.RC).toBe('52');
    expect(deployErrorCodeOf('source', second)).toBe('SOURCE_FAILED');
  });

  test('build падает → RC=53, BUILD_FAILED, шаг run не должен исполняться', () => {
    const { root, bin } = sandboxRoot('bios-deploy-build-');
    stub(
      bin,
      'git',
      [
        'if [ "$1" = "ls-remote" ]; then printf "x\\trefs/heads/master\\n"; exit 0; fi',
        GIT_STUB_CLONE,
        'exit 0',
      ].join('\n'),
    );
    stub(
      bin,
      'docker',
      'if [ "$1" = "info" ]; then exit 0; fi\nif [ "$1" = "rm" ]; then exit 0; fi\necho "error: dockerfile parse error" >&2\nexit 1\n',
    );
    const plan = buildDeployPlan(input(root));
    const preflight = runStep(plan[0].command, bin);
    const source = runStep(plan[1].command, bin);
    const build = runStep(plan[2].command, bin);
    expect(preflight.markers.RC).toBe('0');
    expect(source.markers.RC).toBe('0');
    expect(deployErrorCodeOf('build', build)).toBe('BUILD_FAILED');
    expect(build.log).toContain('dockerfile parse error');
  });

  test('остановка на первом неуспехе — обязанность исполнителя, план её не делает', () => {
    const { root, bin } = sandboxRoot('bios-deploy-stop-');
    stub(bin, 'git', 'if [ "$1" = "ls-remote" ]; then exit 128; fi\nexit 0\n');
    stub(bin, 'docker', 'exit 0\n');
    const plan = buildDeployPlan(input(root));
    runStep(plan[0].command, bin);
    const source = runStep(plan[1].command, bin);
    const run = runStep(plan[3].command, bin);
    expect(source.markers.RC).toBe('52');
    // run-шаг сам по себе «успешен» (docker-стаб), и только исполнитель решает,
    // что до него дело не дойдёт.
    expect(run.markers.RC).toBe('0');
  });
});

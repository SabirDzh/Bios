import { priv, shq } from '../servers/agent/shell-quote';
import type { SshErrorCode } from '../servers/ssh/ssh-runner';
import type { DeployErrorCode, DeployStepName } from './deployment.types';

export type { DeployStepName };

/**
 * Пути НА ХОСТЕ. Состоят из UUIDv7 проекта/конфигурации и корня из конфига;
 * пользовательских строк в путях нет, но `shq()` применяется всё равно:
 * инвариант «в shell уходит только экранированное» не должен зависеть от того,
 * что боевые значения аккуратные (правило части 3).
 */
export interface DeployPaths {
  root: string;
  srcDir: string;
  logDir: string;
}

export function deployPaths(
  rootDir: string,
  projectId: string,
  configId: string,
): DeployPaths {
  const root = `${rootDir}/${projectId}/${configId}`;
  return { root, srcDir: `${root}/src`, logDir: `${root}/logs` };
}

export interface StepCommand {
  step: DeployStepName;
  command: string;
}

export interface DeployPlanInput {
  paths: DeployPaths;
  root: boolean;
  repoUrl: string;
  ref: string;
  dockerfile: string;
  imageTag: string;
  containerName: string;
  ports: string[];
  logTailBytes: number;
  hostLogBytes: number;
}

/**
 * Коды наших preflight-проверок. 42/45/46 совпадают с buildInstallScript
 * (agent-script.ts:141-150): диагноз состояния хоста не должен разъезжаться
 * между «поставить агента» и «задеплоить».
 */
export const DEPLOY_EXIT_CODES = {
  DOCKER: 42,
  SYSTEMD: 43,
  DOCKER_PERM: 45,
  DOCKER_SOCKET: 46,
  GIT: 50,
  REF: 51,
  SOURCE: 52,
  BUILD: 53,
  RUN: 54,
  DOCKERFILE: 55,
} as const;

/**
 * Обёртка шага: полный вывод — в файл на хосте, в stdout — только хвост.
 * Причина измерена (п.7): node-ssh складывает все чанки в массив и склеивает в
 * конце, поэтому «большой лог» = RAM панели.
 *
 * Маркеры значений пишутся НЕ в stdout (он перехвачен в лог-файл), а в kv-файл,
 * который обёртка печатает в stdout уже после subshell.
 */
function step(
  name: DeployStepName,
  paths: DeployPaths,
  root: boolean,
  tailBytes: number,
  hostLogBytes: number,
  body: string[],
): StepCommand {
  const log = `${paths.logDir}/${name}.log`;
  const kv = `${paths.logDir}/${name}.kv`;
  const script = [
    'set -u',
    `mkdir -p ${shq(paths.logDir)}`,
    `: > ${shq(kv)}`,
    `kv() { printf '%s=%s\\n' "$1" "$2" >> ${shq(kv)}; }`,
    '( set -eu',
    ...body,
    `) > ${shq(log)} 2>&1`,
    'RC=$?',
    // Ограничиваем и файл на ХОСТЕ: без этого каждый следующий деплой оставлял
    // бы на диске клиента полный вывод сборки, сколько бы та ни напечатала.
    // Ограничение постфактум, а не в трубе: труба вернула бы $? от tail, а не от
    // шага. Пик RAM во время шага этим не лечится — см. Known gaps.
    // stderr глушим: он идёт в тот же канал, что и конверт.
    `tail -c ${hostLogBytes} ${shq(log)} > ${shq(log + '.cap')} 2>/dev/null && mv -f ${shq(log + '.cap')} ${shq(log)} || true`,
    `printf 'BIOS_STEP=%s\\n' ${shq(name)}`,
    `printf 'BIOS_RC=%s\\n' "$RC"`,
    `cat ${shq(kv)} || true`,
    `printf 'BIOS_LOG_BEGIN\\n'`,
    `tail -c ${tailBytes} ${shq(log)} || true`,
    `printf '\\nBIOS_LOG_END\\n'`,
    'exit "$RC"',
  ].join('\n');
  return { step: name, command: priv(script, root) };
}

function preflightBody(paths: DeployPaths): string[] {
  return [
    `command -v git >/dev/null 2>&1 || { echo BIOS_ERR_GIT >&2; exit ${DEPLOY_EXIT_CODES.GIT}; }`,
    `command -v docker >/dev/null 2>&1 || { echo BIOS_ERR_DOCKER >&2; exit ${DEPLOY_EXIT_CODES.DOCKER}; }`,
    'docker info >/dev/null 2>&1 || {',
    '  err=$(docker info 2>&1 || true)',
    '  case "$err" in',
    `    *"permission denied"*) echo BIOS_ERR_DOCKER_PERM >&2; exit ${DEPLOY_EXIT_CODES.DOCKER_PERM} ;;`,
    `    *"Cannot connect to the Docker daemon"*) echo BIOS_ERR_DOCKER_SOCKET >&2; exit ${DEPLOY_EXIT_CODES.DOCKER_SOCKET} ;;`,
    `    *) echo BIOS_ERR_DOCKER >&2; exit ${DEPLOY_EXIT_CODES.DOCKER} ;;`,
    '  esac',
    '}',
    `mkdir -p ${shq(paths.root)}`,
  ];
}

function sourceBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  const url = shq(input.repoUrl);
  const ref = shq(input.ref);
  const dir = shq(paths.srcDir);
  const probe = shq(`${paths.logDir}/source.probe`);
  return [
    // `git ls-remote … | grep -q .` без pipefail отдаёт статус `grep`, и сетевой
    // отказ (`ls-remote` упал) неотличим от отсутствующей ветки (`ls-remote`
    // работал, но выдал 0 строк). Замер: `sh -c 'ls /no-such-dir 2>/dev/null
    // | grep -q .; echo $?'` → 1 в обоих случаях. Поэтому код проверяется отдельно.
    `git ls-remote --heads --tags ${url} ${ref} > ${probe} 2>&1 || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    `[ -s ${probe} ] || { echo BIOS_ERR_REF >&2; exit ${DEPLOY_EXIT_CODES.REF}; }`,
    `if [ -d ${dir}/.git ]; then`,
    `  git -C ${dir} fetch --depth 1 origin ${ref} || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    `  git -C ${dir} reset --hard FETCH_HEAD || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    'else',
    `  git clone --depth 1 --branch ${ref} ${url} ${dir} || { echo BIOS_ERR_SOURCE >&2; exit ${DEPLOY_EXIT_CODES.SOURCE}; }`,
    'fi',
    // Полный SHA, не `--short`: короткую форму выбирает UI для отображения, а
    // история должна хранить идентичность кода.
    `kv BIOS_SHA "$(git -C ${dir} rev-parse HEAD)"`,
  ];
}

function buildBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  const file = shq(`${paths.srcDir}/${input.dockerfile}`);
  const context = input.dockerfile.includes('/')
    ? shq(
        `${paths.srcDir}/${input.dockerfile.slice(
          0,
          input.dockerfile.lastIndexOf('/'),
        )}`,
      )
    : shq(paths.srcDir);
  return [
    `[ -f ${file} ] || { echo BIOS_ERR_DOCKERFILE >&2; exit ${DEPLOY_EXIT_CODES.DOCKERFILE}; }`,
    // `-q` даёт ровно одну строку — идентификатор образа (замер п.3).
    `IMG=$(docker build -q --file ${file} -t ${shq(input.imageTag)} ${context}) || { echo BIOS_ERR_BUILD >&2; exit ${DEPLOY_EXIT_CODES.BUILD}; }`,
    `kv BIOS_IMAGE "$IMG"`,
  ];
}

function runBody(paths: DeployPaths, input: DeployPlanInput): string[] {
  void paths;
  const flags = input.ports.map((mapping) => `-p ${shq(mapping)}`).join(' ');
  const name = shq(input.containerName);
  return [
    // ПОРЯДОК ОСОЗНАННО РАЗРУШИТЕЛЬНЫЙ: старый контейнер снимается до того, как
    // новый подтверждён. Это MVP-схема «stop then start»: у панели нет второго
    // набора портов и прокси, чтобы поднять кандидата и переключить трафик.
    // Следствие — `RUN_FAILED` означает «старый сервис уже удалён», и
    // диагностику это надо показывать честно (см. Known gaps).
    // Замер (п.2): `docker rm -f` несуществующего контейнера возвращает 0;
    // `|| true` оставляем как защиту от расхождений CLI, а не от замеренного кода.
    `docker rm -f ${name} >/dev/null 2>&1 || true`,
    `CID=$(docker run -d --name ${name}${flags ? ` ${flags}` : ''} ${shq(input.imageTag)}) || { echo BIOS_ERR_RUN >&2; exit ${DEPLOY_EXIT_CODES.RUN}; }`,
    `kv BIOS_CID "$CID"`,
  ];
}

/** Ровно четыре шага. Исполнитель обязан идти по порядку и остановиться на первом неуспехе. */
export function buildDeployPlan(input: DeployPlanInput): StepCommand[] {
  return [
    step(
      'preflight',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      preflightBody(input.paths),
    ),
    step(
      'source',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      sourceBody(input.paths, input),
    ),
    step(
      'build',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      buildBody(input.paths, input),
    ),
    step(
      'run',
      input.paths,
      input.root,
      input.logTailBytes,
      input.hostLogBytes,
      runBody(input.paths, input),
    ),
  ];
}

export interface StepResult {
  code: number | null;
  /** Ключи без префикса: `markers.RC`, `markers.SHA`, `markers.CID`. */
  markers: Record<string, string>;
  log: string;
  /** Есть и `BIOS_LOG_BEGIN`, и `BIOS_LOG_END`: вывод сформирован обёрткой. */
  protocolOk: boolean;
}

const MARKER_RE = /^BIOS_([A-Z]+)=(.*)$/;
const BEGIN = 'BIOS_LOG_BEGIN';
const END_MARK = 'BIOS_LOG_END';
const LOG_RE = /BIOS_LOG_BEGIN\n([\s\S]*?)\n?BIOS_LOG_END/;

/**
 * Маркеры читаются ТОЛЬКО из служебной области до `BIOS_LOG_BEGIN`. Иначе вывод
 * `docker build`, который печатает в том числе текст Dockerfile, может содержать
 * строку `BIOS_RC=0`, и парсер перезаписал бы настоящий код шага — неуспешный
 * шаг стал бы успешным, и исполнитель пошёл бы дальше.
 * Логи — данные, а не протокол: из `log` не извлекается ничего.
 */
export function parseStepResult(
  stdout: string,
  stderr: string,
  code: number | null,
): StepResult {
  const begin = stdout.indexOf(BEGIN);
  const end = stdout.indexOf(END_MARK);
  const protocolOk = begin !== -1 && end !== -1 && end > begin;
  const head = protocolOk ? stdout.slice(0, begin) : '';
  const markers: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const match = MARKER_RE.exec(line.trim());
    if (match) markers[match[1]] = match[2];
  }
  const logMatch = protocolOk ? LOG_RE.exec(stdout) : null;
  const tail = (logMatch?.[1] ?? '').trim();
  const err = stderr.trim();
  return {
    code,
    markers,
    log: [tail, err].filter((part) => part !== '').join('\n'),
    protocolOk,
  };
}

/**
 * Диагностика = (шаг, код, текст). Специфичные коды различают «git нет»,
 * «докер молчит», «ветки нет»; остальное маппится по шагу, потому что
 * `docker build` и `docker run` падают с кодами, которые CLI не систематизирует.
 *
 * Источник кода — маркер `BIOS_RC` из служебной области, но он обязан
 * соглашаться с кодом завершения SSH-канала: обёртка делает `exit "$RC"`,
 * поэтому расхождение означает, что конверт подделан или собран не обёрткой.
 */
export function deployErrorCodeOf(
  step: DeployStepName,
  result: StepResult,
): DeployErrorCode | null {
  if (!result.protocolOk) return 'COMMAND_FAILED';
  const raw = result.markers.RC;
  const rc = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(rc)) return 'COMMAND_FAILED';
  if (result.code !== null && result.code !== rc) return 'COMMAND_FAILED';
  const byExit: Record<number, DeployErrorCode> = {
    [DEPLOY_EXIT_CODES.GIT]: 'GIT_MISSING',
    [DEPLOY_EXIT_CODES.DOCKER]: 'DOCKER_MISSING',
    [DEPLOY_EXIT_CODES.DOCKER_PERM]: 'DOCKER_PERMISSION_DENIED',
    [DEPLOY_EXIT_CODES.DOCKER_SOCKET]: 'DOCKER_SOCKET_UNREACHABLE',
    [DEPLOY_EXIT_CODES.REF]: 'REF_NOT_FOUND',
    [DEPLOY_EXIT_CODES.SOURCE]: 'SOURCE_FAILED',
    [DEPLOY_EXIT_CODES.BUILD]: 'BUILD_FAILED',
    [DEPLOY_EXIT_CODES.RUN]: 'RUN_FAILED',
    [DEPLOY_EXIT_CODES.DOCKERFILE]: 'DOCKERFILE_MISSING',
  };
  const mapped = byExit[rc];
  if (mapped) return mapped;
  if (rc === 0) {
    // Нулевой код ничего не обещает (правило части 3, agent.service.ts):
    // доверяем только когда шаг подтвердил себя маркером.
    return result.markers.STEP === step ? null : 'COMMAND_FAILED';
  }
  if (step === 'build') return 'BUILD_FAILED';
  if (step === 'run') return 'RUN_FAILED';
  if (step === 'source') return 'SOURCE_FAILED';
  return 'COMMAND_FAILED';
}

/**
 * Код шва → диагноз деплоя. Различимые причины сохраняются: «хост не принимает
 * ключ» — это не «хост не отвечает», и сводить их к одному коду значит врать
 * оператору про причину.
 */
export function deployCodeOfSsh(code: SshErrorCode): DeployErrorCode {
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'HOST_KEY_NOT_TRUSTED':
      return 'HOST_KEY_NOT_TRUSTED';
    case 'HOST_KEY_MISMATCH':
      return 'HOST_KEY_MISMATCH';
    case 'AUTH_FAILED':
      return 'AUTH_FAILED';
    case 'REFUSED':
      return 'REFUSED';
    case 'DNS':
      return 'DNS';
    default:
      return 'HOST_UNREACHABLE';
  }
}

export function toPrismaStep(
  step: DeployStepName,
): 'PREFLIGHT' | 'SOURCE' | 'BUILD' | 'RUN' {
  return step.toUpperCase() as 'PREFLIGHT' | 'SOURCE' | 'BUILD' | 'RUN';
}

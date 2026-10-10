import { priv, shq } from './shell-quote';
import type { SshErrorCode } from '../ssh/ssh-runner';

export const AGENT_UNIT = 'bios-agent.service';

export interface AgentPaths {
  dir: string;
  unitPath: string;
  manifestPath: string;
  heartbeatPath: string;
  scriptPath: string;
}

const PROD_DIR = '/opt/bios-agent';

export const PROD_AGENT_PATHS: AgentPaths = {
  dir: PROD_DIR,
  unitPath: `/etc/systemd/system/${AGENT_UNIT}`,
  manifestPath: `${PROD_DIR}/agent.json`,
  heartbeatPath: `${PROD_DIR}/heartbeat`,
  scriptPath: `${PROD_DIR}/agent.sh`,
};

export type AgentUnitState =
  'active' | 'inactive' | 'failed' | 'no-unit' | 'no-systemd' | 'unknown';

export type AgentStatus = 'NOT_INSTALLED' | 'FAILED' | 'STALE' | 'ACTIVE';

export interface AgentManifest {
  version: string;
  workspaceId: string;
  serverId: string;
}

/**
 * Сырой вывод команды чтения. Каждый факт разведён отдельно, потому что «файла
 * нет», «файл есть, но не читается» и «systemd нет» — это разные состояния,
 * а не один null (замечание ревью №6).
 */
export interface AgentRawState {
  protocolOk: boolean;
  systemd: 'ok' | 'missing' | 'unreadable';
  manifestFile: 'present' | 'absent' | 'unreadable';
  manifest: AgentManifest | null;
  manifestParseError: boolean;
  unit: AgentUnitState;
  heartbeatSec: number | null;
  nowSec: number | null;
}

const UNIT_STATES = new Set<AgentUnitState>([
  'active',
  'inactive',
  'failed',
  'no-unit',
  'no-systemd',
  'unknown',
]);

/** agent.sh: пишет heartbeat, пока Docker-сокет отвечает. */
function agentScriptBody(paths: AgentPaths): string {
  return [
    '#!/bin/sh',
    'while :',
    'do',
    '  if docker info >/dev/null 2>&1',
    '  then',
    `    date -u +%s > ${shq(paths.heartbeatPath)}`,
    '  fi',
    '  sleep 15',
    'done',
  ].join('\n');
}

function unitBody(paths: AgentPaths): string {
  return [
    '[Unit]',
    'Description=Bios host agent',
    'After=docker.service',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=/bin/sh ${paths.scriptPath}`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n');
}

export function buildDockerVersionCommand(): string {
  return "docker version --format '{{.Server.Version}}'";
}

/**
 * Протокол чтения — шесть ключей, отсутствующее значение явно `-`. Никаких
 * пользовательских данных тут нет, но пути всё равно идут через shq: инвариант
 * «в shell-строку попадает только экранированное» не должен depender-ся на то,
 * что боевые пути аккуратные.
 */
export function buildAgentReadCommand(
  paths: AgentPaths = PROD_AGENT_PATHS,
): string {
  const manifest = shq(paths.manifestPath);
  const heartbeat = shq(paths.heartbeatPath);
  return [
    'set -u',
    `printf 'SD=%s\\n' "$(command -v systemctl >/dev/null 2>&1 && printf ok || printf missing)"`,
    `printf 'MF=%s\\n' "$(if [ -f ${manifest} ]; then printf present; else printf absent; fi)"`,
    `printf 'JSON=%s\\n' "$(cat ${manifest} 2>/dev/null || printf -)"`,
    `printf 'UNIT=%s\\n' "$(systemctl is-active ${AGENT_UNIT} 2>/dev/null || printf no-unit)"`,
    `printf 'HB=%s\\n' "$(cat ${heartbeat} 2>/dev/null || printf -)"`,
    `printf 'NOW=%s\\n' "$(date -u +%s)"`,
  ].join('\n');
}

export function buildInstallScript(input: {
  workspaceId: string;
  serverId: string;
  version: string;
  root: boolean;
  paths?: AgentPaths;
}): string {
  const paths = input.paths ?? PROD_AGENT_PATHS;
  const { root } = input;
  // Манифест — статический JSON; installedAt живёт в БД панели, поэтому дата
  // и перекос часов удалённого хоста на «когда установили» не влияют.
  const manifest = JSON.stringify({
    version: input.version,
    workspaceId: input.workspaceId,
    serverId: input.serverId,
  });
  const writeFile = (path: string, content: string, mode: string): string =>
    priv(
      `printf '%s\\n' ${shq(content)} > ${shq(path)} && chmod ${shq(mode)} ${shq(path)}`,
      root,
    );

  const preflight = [
    'command -v docker >/dev/null 2>&1 || { echo BIOS_ERR_DOCKER >&2; exit 42; }',
    'docker info >/dev/null 2>&1 || {',
    '  err=$(docker info 2>&1 || true)',
    '  case "$err" in',
    '    *"permission denied"*) echo BIOS_ERR_DOCKER_PERM >&2; exit 45 ;;',
    '    *"Cannot connect to the Docker daemon"*) echo BIOS_ERR_DOCKER_SOCKET >&2; exit 46 ;;',
    '    *) echo BIOS_ERR_DOCKER >&2; exit 42 ;;',
    '  esac',
    '}',
    'command -v systemctl >/dev/null 2>&1 || { echo BIOS_ERR_SYSTEMD >&2; exit 43; }',
  ];

  return [
    'set -eu',
    ...preflight,
    priv(`mkdir -p ${shq(paths.dir)} && chmod 0755 ${shq(paths.dir)}`, root),
    writeFile(paths.manifestPath, manifest, '0644'),
    writeFile(paths.scriptPath, agentScriptBody(paths), '0755'),
    writeFile(paths.unitPath, unitBody(paths), '0644'),
    priv(
      `systemctl daemon-reload && systemctl enable ${AGENT_UNIT} && systemctl restart ${AGENT_UNIT}`,
      root,
    ),
  ].join('\n');
}

function unreadableState(): AgentRawState {
  return {
    protocolOk: false,
    systemd: 'unreadable',
    manifestFile: 'unreadable',
    manifest: null,
    manifestParseError: false,
    unit: 'unknown',
    heartbeatSec: null,
    nowSec: null,
  };
}

export function parseAgentState(stdout: string): AgentRawState {
  const field = (key: string): string | null => {
    const match = new RegExp(`^${key}=(.*)$`, 'm').exec(stdout);
    return match ? match[1].trim() : null;
  };
  const toNumber = (value: string | null): number | null =>
    value !== null && /^\d+$/.test(value) ? Number(value) : null;

  const sd = field('SD');
  const mf = field('MF');
  const unit = field('UNIT');
  const now = toNumber(field('NOW'));
  const json = field('JSON');
  const hb = field('HB');

  // Нет хотя бы одного обязательного ключа — протокол не соблюден, выводимоe
  // состояние неизвестно (это не «агент не установлен»).
  if (sd === null || mf === null || unit === null || now === null) {
    return unreadableState();
  }

  let manifest: AgentManifest | null = null;
  let manifestParseError = false;
  if (json !== null && json !== '-' && mf === 'present') {
    try {
      const parsed: unknown = JSON.parse(json);
      const shape = parsed as Partial<AgentManifest>;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof shape.version === 'string' &&
        typeof shape.workspaceId === 'string' &&
        typeof shape.serverId === 'string'
      ) {
        manifest = parsed as AgentManifest;
      } else {
        manifestParseError = true;
      }
    } catch {
      manifestParseError = true;
    }
  }

  return {
    protocolOk: true,
    systemd: sd === 'ok' ? 'ok' : sd === 'missing' ? 'missing' : 'unreadable',
    manifestFile:
      mf === 'present' ? 'present' : mf === 'absent' ? 'absent' : 'unreadable',
    manifest,
    manifestParseError,
    unit: UNIT_STATES.has(unit as AgentUnitState)
      ? (unit as AgentUnitState)
      : 'unknown',
    heartbeatSec: hb === null || hb === '-' ? null : toNumber(hb),
    nowSec: now,
  };
}

export function agentStatusOf(
  state: AgentRawState,
  staleSec: number,
  expected: { workspaceId: string; serverId: string },
): { status: AgentStatus; errorCode: SshErrorCode | null } {
  if (!state.protocolOk || state.systemd === 'unreadable') {
    return { status: 'FAILED', errorCode: 'READ_FAILED' };
  }

  if (state.manifestFile === 'absent') {
    // Юнит запущен, а манифеста нет — установка битая; иначе действительно не установлено.
    return state.unit === 'active'
      ? { status: 'FAILED', errorCode: 'AGENT_MANIFEST_MISSING' }
      : { status: 'NOT_INSTALLED', errorCode: null };
  }
  if (state.manifestFile === 'unreadable') {
    return { status: 'FAILED', errorCode: 'READ_FAILED' };
  }
  if (state.manifestParseError || state.manifest === null) {
    return { status: 'FAILED', errorCode: 'MANIFEST_INVALID' };
  }
  if (
    state.manifest.workspaceId !== expected.workspaceId ||
    state.manifest.serverId !== expected.serverId
  ) {
    return { status: 'FAILED', errorCode: 'IDENTITY_MISMATCH' };
  }
  if (state.systemd === 'missing') {
    return { status: 'FAILED', errorCode: 'SYSTEMD_MISSING' };
  }
  if (state.unit !== 'active') {
    return { status: 'FAILED', errorCode: 'AGENT_NOT_RUNNING' };
  }
  if (state.heartbeatSec === null) {
    return { status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' };
  }
  if (state.nowSec !== null && state.nowSec - state.heartbeatSec > staleSec) {
    return { status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' };
  }
  return { status: 'ACTIVE', errorCode: null };
}

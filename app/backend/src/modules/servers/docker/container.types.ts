/**
 * Ответы Docker API -> контракт панели. Мапперы принимаю структурные типы с
 * необязательными полями, а не типы dockerode: демон разных версий отдаёт
 * разные наборы, и отсутствие поля должно давать null, а не падение.
 */

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  /** Человекочитаемый статус демона («Up 2 hours»): есть только в списке. */
  status: string;
  /** Время СОЗДАНИЯ контейнера (Created в списке — не время последнего запуска). */
  createdAt: string;
  exitCode: number | null;
}

export type ContainerHealth = 'NONE' | 'HEALTHY' | 'UNHEALTHY' | 'STARTING';

export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  state: string;
  createdAt: string | null;
  /** Время последнего запуска — только из inspect. */
  startedAt: string | null;
  exitCode: number | null;
  command: string;
  restartCount: number;
  oomKilled: boolean;
  health: ContainerHealth;
  ports: Array<{
    ip: string;
    privatePort: number;
    publicPort: number | null;
    type: string;
  }>;
  labels: Record<string, string>;
}

interface RawSummary {
  Id?: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Created?: number;
}

export interface RawInspect {
  Id?: string;
  Name?: string;
  Created?: string;
  State?: {
    Status?: string;
    StartedAt?: string;
    ExitCode?: number;
    OOMKilled?: boolean;
    RestartCount?: number;
    Health?: { Status?: string };
  };
  Config?: {
    Image?: string;
    Cmd?: string[] | null;
    Labels?: Record<string, string>;
    Tty?: boolean;
  };
  NetworkSettings?: {
    Ports?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    > | null;
  };
}

const EXIT_CODE_RE = /Exited \((-?\d+)\)/;

/**
 * Number(null) === 0 — поэтому nullable-код завершения НЕ оборачивается в Number:
 * у работающего контейнера кода текущего запуска нет.
 */
export function parseExitCode(status: string): number | null {
  const match = EXIT_CODE_RE.exec(status);
  return match ? Number(match[1]) : null;
}

export function toSummary(raw: RawSummary): ContainerSummary {
  const status = raw.Status ?? '';
  return {
    id: raw.Id ?? '',
    name: (raw.Names?.[0] ?? '').replace(/^\//, ''),
    image: raw.Image ?? '',
    state: raw.State ?? 'unknown',
    status,
    createdAt: new Date((raw.Created ?? 0) * 1000).toISOString(),
    exitCode: parseExitCode(status),
  };
}

export function toDetails(raw: RawInspect): ContainerDetails {
  const state = raw.State ?? {};
  const config = raw.Config ?? {};
  const ports = Object.entries(raw.NetworkSettings?.Ports ?? {})
    .flatMap(([key, bindings]) =>
      (bindings ?? []).map((binding) => {
        const [privatePort, type] = key.split('/');
        return {
          ip: binding.HostIp ?? '',
          privatePort: Number(privatePort),
          publicPort:
            binding.HostPort && binding.HostPort !== ''
              ? Number(binding.HostPort)
              : null,
          type: type ?? 'tcp',
        };
      }),
    )
    .filter((port) => Number.isFinite(port.privatePort));

  return {
    id: raw.Id ?? '',
    name: (raw.Name ?? '').replace(/^\//, ''),
    image: config.Image ?? '',
    state: state.Status ?? 'unknown',
    createdAt: isoSeconds(raw.Created),
    startedAt: isoSeconds(state.StartedAt),
    // В inspect код завершения лежит в State.ExitCode, а не в тексте статуса.
    exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
    command: (config.Cmd ?? []).join(' '),
    restartCount: state.RestartCount ?? 0,
    oomKilled: state.OOMKilled ?? false,
    health: healthOf(state.Health?.Status),
    ports,
    labels: config.Labels ?? {},
  };
}

function healthOf(value?: string): ContainerHealth {
  switch (value) {
    case 'healthy':
      return 'HEALTHY';
    case 'unhealthy':
      return 'UNHEALTHY';
    case 'starting':
      return 'STARTING';
    default:
      return 'NONE';
  }
}

/** Демон отдаёт nanosecond-ISO; в контракте панели — миллисекунды. */
function isoSeconds(value?: string): string | null {
  if (!value) return null;
  // Go zero-value: демон пишет `0001-01-01T00:00:00Z` контейнеру, который ещё
  // ни разу не запускался, и stats остановленного контейнера (промер 28.3.2).
  // Для панели это «нет данных», а не дата из первого века.
  if (value.startsWith('0001-01-01')) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Tty контейнера决定了 формат лога: при Tty демон отдаёт ГОЛЫЕ байты без
 * восьмидесятибайтных заголовков. Признак берём из inspect, а не «похожа ли
 * первая строка на заголовок» — raw-поток может начаться с 0x01.
 */
export function hasTty(raw: RawInspect): boolean {
  return raw.Config?.Tty === true;
}

export interface LogLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

/**
 * Ответ на действие. `status` («Up 2 hours») в inspect не живёт — он есть
 * только в списке, поэтому поле `startedAt`: новый таймстемп запуска и есть
 * доказательство, что restart случился.
 */
export interface ContainerActionResponse {
  containerId: string;
  action: 'restart';
  state: string;
  startedAt: string | null;
}

export interface ContainerLogs {
  containerId: string;
  tty: boolean;
  /** Строки в порядке прихода кадров — потоки НЕ разделяются на два буфера. */
  lines: LogLine[];
  truncated: boolean;
  limitBytes: number;
}

/** Замер живого демона: [тип 1 байт][3 нуля][длина BE32][тело]. */
const FRAME_HEADER_BYTES = 8;

/**
 * Один проход по потоку логов: байты считаются в UTF-8 (кириллица вдвое
 * длиннее, чем `.length`), бюджет общий на оба потока, а при переборе остаётся
 * ХВОСТ — окно в два бюджета, из которого старые строки вытесняются снизу.
 */
export async function readLogs(
  stream: NodeJS.ReadableStream,
  tty: boolean,
  budgetBytes: number,
): Promise<{ lines: LogLine[]; truncated: boolean }> {
  const kept: LogLine[] = [];
  const window = budgetBytes * 2;
  let used = 0;
  let truncated = false;
  let buffer = Buffer.alloc(0);

  const push = (text: string, kind: LogLine['stream']): void => {
    kept.push({ stream: kind, text });
    used += Buffer.byteLength(text, 'utf8');
    while (kept.length > 1 && used > window) {
      used -= Buffer.byteLength(kept.shift()?.text ?? '', 'utf8');
      truncated = true;
    }
  };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (tty) {
        const cut = buffer.indexOf(0x0a);
        if (cut < 0) break;
        pushEach(buffer.subarray(0, cut + 1), push, 'stdout');
        buffer = buffer.subarray(cut + 1);
        continue;
      }
      if (buffer.length < FRAME_HEADER_BYTES) break;
      const kind: LogLine['stream'] =
        buffer.readUInt8(0) === 2 ? 'stderr' : 'stdout';
      const size = buffer.readUInt32BE(4);
      if (buffer.length < FRAME_HEADER_BYTES + size) break;
      pushEach(
        buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size),
        push,
        kind,
      );
      buffer = buffer.subarray(FRAME_HEADER_BYTES + size);
    }
  }
  // Недочитанный хвост raw-потока (демон не поставил \n) — тоже строка.
  if (tty && buffer.length > 0) pushEach(buffer, push, 'stdout');

  while (kept.length > 0 && used > budgetBytes) {
    used -= Buffer.byteLength(kept.shift()?.text ?? '', 'utf8');
    truncated = true;
  }
  return { lines: kept, truncated };
}

/** Кадр может содержать несколько строк; пустая строка после \n — не строка. */
function pushEach(
  body: Buffer,
  push: (text: string, kind: LogLine['stream']) => void,
  kind: LogLine['stream'],
): void {
  const pieces = body.toString('utf8').split('\n');
  if (pieces.at(-1) === '') pieces.pop();
  for (const piece of pieces) push(piece.replace(/\r$/, ''), kind);
}

export interface ContainerStats {
  containerId: string;
  readAt: string | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  blkReadBytes: number | null;
  blkWriteBytes: number | null;
}

interface DockerStatsResponse {
  read?: string;
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number; limit?: number };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: {
    io_service_bytes_recursive?: Array<{ op?: string; value?: number }>;
  };
}

const num = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const nullableNum = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * cpu% = дельта двух выборок, которые демон делает внутри одного ответа
 * (`stream:false`, промер: ~1064 мс). `system_cpu_usage` и `online_cpus` —
 * ЧИСЛА внутри cpu_stats/precpu_stats (замер 28.3.2), а не объект и не на
 * верхнем уровне; `percpu_usage` на этом демоне отсутствует вовсе, поэтому
 * fallback не должен превращаться в «1 CPU».
 */
export function toStats(
  containerId: string,
  raw: DockerStatsResponse,
): ContainerStats {
  const cpu = raw.cpu_stats ?? {};
  const pre = raw.precpu_stats ?? {};
  const cpuDelta =
    num(cpu.cpu_usage?.total_usage) - num(pre.cpu_usage?.total_usage);
  const sysDelta = num(cpu.system_cpu_usage) - num(pre.system_cpu_usage);
  const cpus =
    num(cpu.online_cpus) || (cpu.cpu_usage?.percpu_usage?.length ?? 0);
  const net = Object.values(raw.networks ?? {})[0] ?? {};
  const disk = ioByOp(raw.blkio_stats?.io_service_bytes_recursive);

  return {
    containerId,
    readAt: isoSeconds(raw.read),
    cpuPercent:
      cpuDelta > 0 && sysDelta > 0 && cpus > 0
        ? round3((cpuDelta / sysDelta) * cpus * 100)
        : null,
    memoryUsageBytes: nullableNum(raw.memory_stats?.usage),
    memoryLimitBytes: nullableNum(raw.memory_stats?.limit),
    netRxBytes: nullableNum(net.rx_bytes),
    netTxBytes: nullableNum(net.tx_bytes),
    blkReadBytes: disk.read,
    blkWriteBytes: disk.write,
  };
}

/** Демон отдаёт по записи на устройство: значения одного op суммируются. */
function ioByOp(entries?: Array<{ op?: string; value?: number }>): {
  read: number | null;
  write: number | null;
} {
  if (!entries) return { read: null, write: null };
  const sum = (op: string): number =>
    entries
      .filter((entry) => entry.op === op)
      .reduce((acc, entry) => acc + num(entry.value), 0);
  return { read: sum('read'), write: sum('write') };
}

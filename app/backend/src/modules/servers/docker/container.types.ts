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

interface RawInspect {
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

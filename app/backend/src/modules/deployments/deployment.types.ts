import type { DeploymentStatus } from '@prisma/client';

/**
 * Словарь кодов деплоя. Живёт в TypeScript, а не enum'ом в БД: список
 * пополняется без DDL — тот же приём, что `Server.lastAgentErrorCode`
 * (schema.prisma).
 */
export type DeployErrorCode =
  | 'GIT_MISSING'
  | 'DOCKER_MISSING'
  | 'DOCKER_PERMISSION_DENIED'
  | 'DOCKER_SOCKET_UNREACHABLE'
  | 'REF_NOT_FOUND'
  | 'DOCKERFILE_MISSING'
  | 'SOURCE_FAILED'
  | 'BUILD_FAILED'
  | 'RUN_FAILED'
  | 'TIMEOUT'
  | 'HOST_UNREACHABLE'
  /** Хост отвечает, порт открыт, дошли до аутентификации и не прошли: дело в ключе. */
  | 'AUTH_FAILED'
  | 'REFUSED'
  | 'DNS'
  /** Отпечаток ещё не подтверждён — «ждём TOFU». */
  | 'HOST_KEY_NOT_TRUSTED'
  /** Запиненный отпечаток перестал совпадать: доверие сломалось, а не «не успели». */
  | 'HOST_KEY_MISMATCH'
  /** Снимок конфигурации в задаче не читается как план деплоя. */
  | 'SNAPSHOT_INVALID'
  | 'PANEL_RESTARTED'
  /** Запустивший вышел из воркспейса, пока задача стояла в очереди. */
  | 'ACCESS_LOST'
  | 'COMMAND_FAILED';

export type DeployStepName = 'preflight' | 'source' | 'build' | 'run';

export interface DeploymentResponse {
  id: string;
  projectId: string;
  configId: string;
  status: DeploymentStatus;
  /** NULL, пока задача в очереди. */
  step: DeployStepName | null;
  /** Полное имя образа: `bios-deploy:<id деплоя>`; задел среза rollback. */
  imageTag: string | null;
  commitSha: string | null;
  containerId: string | null;
  errorCode: DeployErrorCode | null;
  exitCode: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Длительность отдельным полем: её просят в метрике спринта, и UI не должен
   *  вычитать даты, у которых `finishedAt` может быть NULL. */
  durationMs: number | null;
  triggeredById: string;
  createdAt: Date;
}

export interface DeploymentLogsResponse {
  deploymentId: string;
  status: DeploymentStatus;
  finished: boolean;
  log: string;
  sizeBytes: number;
}

/**
 * Снимок конфигурации на момент постановки в очередь. Исполнитель строит план
 * ИМЕННО из него: правка конфигурации между `POST /deployments` и стартом задачи
 * не должна менять то, что уже обещано пользователю. Поле `Json?` в БД, поэтому
 * форма проверяется на чтении, а не на записи.
 */
export interface DeploySnapshot {
  method: 'GIT_PULL';
  ref: string;
  dockerfile: string;
  containerName: string;
  ports: string[];
  repoUrl: string;
}

/** `null` — снимок не читается: у задачи нет права исполнять что-то наугад. */
export function toDeploySnapshot(raw: unknown): DeploySnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return null;
  const value = raw as Record<string, unknown>;
  if (
    value.method !== 'GIT_PULL' ||
    typeof value.ref !== 'string' ||
    typeof value.dockerfile !== 'string' ||
    typeof value.containerName !== 'string' ||
    typeof value.repoUrl !== 'string' ||
    !Array.isArray(value.ports) ||
    !value.ports.every((port) => typeof port === 'string')
  ) {
    return null;
  }
  return {
    method: 'GIT_PULL',
    ref: value.ref,
    dockerfile: value.dockerfile,
    containerName: value.containerName,
    ports: value.ports,
    repoUrl: value.repoUrl,
  };
}

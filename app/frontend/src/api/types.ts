/** Типы повторяют DTO/ответы бэкенда (NestJS). */

/** Курсорная страница list-эндпоинтов: { items, nextCursor }. */
export interface CursorPage<T> {
  items: T[];
  /** null — последняя страница. */
  nextCursor: string | null;
}

export interface CursorParams {
  cursor?: string;
  limit?: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  userId: string;
  username: string;
  email: string;
  sid: string;
}

export type WorkspaceRole = 'OWNER' | 'MEMBER';

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  /** Открытый токен — только в ответе на создание. */
  token: string;
}

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

export interface InviteMemberInput {
  email: string;
}

export interface AcceptInvitationInput {
  token: string;
}

export type ServerStatus = 'PENDING' | 'ONLINE' | 'OFFLINE';
export type ServerAuthType = 'PASSWORD' | 'KEY';
export type AgentStatus = 'NOT_INSTALLED' | 'FAILED' | 'STALE' | 'ACTIVE';

export interface Server {
  id: string;
  workspaceId: string;
  name: string;
  host: string;
  port: number;
  sshUsername: string;
  authType: ServerAuthType;
  status: ServerStatus;
  hostKeyFingerprint: string | null;
  dockerVersion: string | null;
  /** Строка ОС с хоста (hostnamectl → uname); null — хост ещё не опрошен. */
  osName: string | null;
  agentVersion: string | null;
  agentInstalledAt: string | null;
  lastAgentStatus: AgentStatus | null;
  lastAgentErrorCode: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerInput {
  name: string;
  host: string;
  port?: number;
  sshUsername: string;
  authType: ServerAuthType;
  sshPassword?: string;
  sshPrivateKey?: string;
  /** Отпечаток, подтверждённый в мастере (test-connection): пин с первого дня. */
  hostKeyFingerprint?: string;
}

/** Тело test-connection: те же поля, что у create, но без имени и без записи. */
export interface TestConnectionInput {
  host: string;
  port?: number;
  sshUsername: string;
  authType: ServerAuthType;
  sshPassword?: string;
  sshPrivateKey?: string;
  /** Отпечаток из предыдущего ответа `trustRequired: true` (TOFU). */
  trustHostKey?: string;
}

export interface TestServerInput {
  /** Отпечаток из предыдущего ответа `trustRequired: true` (TOFU-подтверждение). */
  trustHostKey?: string;
}

/** Ответ POST …/servers/:id/test и …/servers/test-connection; недоступный хост — тоже успешный ответ (200). */
export interface ServerTestResult {
  /** null у test-connection (draft): строки в БД ещё нет. */
  serverId: string | null;
  reachable: boolean;
  trustRequired: boolean;
  status: ServerStatus;
  latencyMs: number;
  dockerVersion: string | null;
  /** Эффективное значение после пробы: свежее или ранее сохранённое. */
  osName: string | null;
  dockerErrorCode: string | null;
  errorCode: string | null;
  hostKeyFingerprint: string | null;
  checkedAt: string;
}

/** Ответ GET …/servers/search: ранжированная выдача движка; total — до обрезки по limit. */
export interface ServerSearchResult {
  items: Server[];
  total: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  repoUrl: string;
}

export interface DeployConfig {
  id: string;
  projectId: string;
  serverId: string;
  name: string;
  method: 'GIT_PULL';
  ref: string;
  dockerfile: string;
  containerName: string;
  ports: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeployConfigInput {
  name: string;
  method: 'GIT_PULL';
  ref: string;
  dockerfile?: string;
  containerName: string;
  ports?: string[];
  serverId: string;
}

export type DeploymentStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'INTERRUPTED';

export type DeployStepName = 'preflight' | 'source' | 'build' | 'run';

export interface Deployment {
  id: string;
  projectId: string;
  configId: string;
  status: DeploymentStatus;
  /** null, пока задача в очереди. */
  step: DeployStepName | null;
  imageTag: string | null;
  commitSha: string | null;
  containerId: string | null;
  errorCode: string | null;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredById: string;
  createdAt: string;
}

export interface DeploymentLogs {
  deploymentId: string;
  status: DeploymentStatus;
  finished: boolean;
  log: string;
  sizeBytes: number;
}

export interface DeploymentListParams {
  projectId?: string;
  configId?: string;
  limit?: number;
}

export interface CreateDeploymentInput {
  projectId: string;
  configId: string;
}

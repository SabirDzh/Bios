import type { ServerAuthType } from '@prisma/client';

export type SshErrorCode =
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'REFUSED'
  | 'DNS'
  | 'HOST_KEY'
  | 'NETWORK'
  | 'HOST_KEY_NOT_TRUSTED'
  | 'HOST_KEY_MISMATCH'
  | 'TARGET_BLOCKED'
  | 'PORT_NOT_ALLOWED'
  | 'RESOLUTION_FAILED'
  | 'DOCKER_MISSING'
  | 'DOCKER_PERMISSION_DENIED'
  | 'DOCKER_SOCKET_UNREACHABLE'
  | 'SYSTEMD_MISSING'
  | 'SUDO_REQUIRED'
  | 'MANIFEST_INVALID'
  | 'IDENTITY_MISMATCH'
  | 'AGENT_NOT_RUNNING'
  | 'AGENT_HEARTBEAT_STALE'
  | 'AGENT_VERSION_MISMATCH'
  | 'AGENT_MANIFEST_MISSING'
  | 'COMMAND_FAILED'
  | 'READ_FAILED';

export class SshFailure extends Error {
  constructor(
    readonly code: SshErrorCode,
    message: string,
    /** Заполняется, когда наблюдали ключ хоста: режим probe и несовпадение пина. */
    readonly observedHostKeyFingerprint?: string,
  ) {
    super(message);
    this.name = 'SshFailure';
  }
}

export interface SshSession {
  host: string;
  /** Проверенный политикой адрес: подключаемся именно к нему. */
  address: string;
  port: number;
  username: string;
  authType: ServerAuthType;
  secret: string;
  /** null = probe: проверяем host key, креденшелы не отправляем. */
  expectedHostKeyFingerprint: string | null;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface SshRunner {
  exec(
    session: SshSession,
    command: string,
    timeoutMs: number,
  ): Promise<SshExecResult>;
}

export const SSH_RUNNER = Symbol('SSH_RUNNER');

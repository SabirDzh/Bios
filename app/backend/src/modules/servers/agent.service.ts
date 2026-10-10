import { Inject, Injectable } from '@nestjs/common';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { AgentReportStatus, Server, ServerStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { classifySshError } from './ssh/classify-ssh-error';
import {
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh/ssh-runner';
import {
  MEMBER_ROLES,
  OWNER_ONLY_ROLES,
  ServersService,
} from './servers.service';
import {
  agentStatusOf,
  buildAgentReadCommand,
  buildInstallScript,
  parseAgentState,
  type AgentStatus,
} from './agent/agent-script';

export interface AgentResponse {
  serverId: string;
  status: AgentStatus;
  version: string | null;
  installedAt: Date | null;
  lastHeartbeatAt: Date | null;
  dockerVersion: string | null;
  errorCode: SshErrorCode | null;
  checkedAt: Date;
}

export interface AgentInstallResponse {
  serverId: string;
  outcome: 'INSTALLED' | 'ALREADY_ACTIVE';
  agent: AgentResponse;
}

/** Маркеры префлайта install-скрипта (Task 7) → коды ошибок API. */
export function hostErrorCode(
  code: number | null,
  stderr: string,
): SshErrorCode {
  const lower = stderr.toLowerCase();
  if (stderr.includes('BIOS_ERR_DOCKER_PERM') || code === 45) {
    return 'DOCKER_PERMISSION_DENIED';
  }
  if (stderr.includes('BIOS_ERR_DOCKER_SOCKET') || code === 46) {
    return 'DOCKER_SOCKET_UNREACHABLE';
  }
  if (stderr.includes('BIOS_ERR_DOCKER') || code === 42)
    return 'DOCKER_MISSING';
  if (stderr.includes('BIOS_ERR_SYSTEMD') || code === 43) {
    return 'SYSTEMD_MISSING';
  }
  if (
    lower.includes('sudo: a password is required') ||
    lower.includes('sudo: interactive')
  ) {
    return 'SUDO_REQUIRED';
  }
  return 'COMMAND_FAILED';
}

const REPORT_STATUS: Record<AgentStatus, AgentReportStatus> = {
  NOT_INSTALLED: AgentReportStatus.NOT_INSTALLED,
  FAILED: AgentReportStatus.FAILED,
  STALE: AgentReportStatus.STALE,
  ACTIVE: AgentReportStatus.ACTIVE,
};

@Injectable()
export class AgentService {
  constructor(
    private readonly servers: ServersService,
    private readonly prisma: PrismaService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async status(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<AgentResponse> {
    const { server, session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      'authenticated',
    );
    const reading = await this.readAgent(session, server);
    await this.recordAgent(server.id, reading);
    return reading;
  }

  async install(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<AgentInstallResponse> {
    const { server, session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      OWNER_ONLY_ROLES,
      'authenticated',
    );

    const before = await this.readAgent(session, server);
    const alreadyActive =
      before.status === 'ACTIVE' &&
      before.version === this.cfg.ssh.agentVersion;

    if (!alreadyActive) {
      const res = await this.execOr424(
        session,
        buildInstallScript({
          workspaceId: server.workspaceId,
          serverId: server.id,
          version: this.cfg.ssh.agentVersion,
          root: server.sshUsername === 'root',
        }),
        this.cfg.ssh.installTimeoutMs,
      );
      if (res.code !== 0) {
        const errorCode = hostErrorCode(res.code, res.stderr);
        await this.recordAgentFailure(server.id, errorCode);
        throw new FailedDependencyException({
          errorCode,
          message: 'agent install failed on host',
        });
      }
    }

    const after = alreadyActive
      ? before
      : await this.readAgent(session, server);
    if (!alreadyActive) {
      // Нулевой код скрипта ничего не обещает: успех = ACTIVE + наша версия (ревью №4).
      const confirmed =
        after.status === 'ACTIVE' &&
        after.version === this.cfg.ssh.agentVersion;
      if (!confirmed) {
        // Версия !== нашей — отдельный диагноз, но только когда агент реально активен:
        // у FAILED-состояния уже есть свой код (MANIFEST_INVALID, IDENTITY_MISMATCH, …),
        // и терять его ради «mismatch» нельзя.
        const versionMismatch =
          after.status === 'ACTIVE' &&
          after.version !== null &&
          after.version !== this.cfg.ssh.agentVersion;
        const errorCode: SshErrorCode = versionMismatch
          ? 'AGENT_VERSION_MISMATCH'
          : (after.errorCode ?? 'AGENT_NOT_RUNNING');
        await this.recordAgent(server.id, after);
        throw new FailedDependencyException({
          errorCode,
          message: 'agent is not confirmed active after install',
        });
      }
    }

    const result: AgentResponse = alreadyActive
      ? after
      : { ...after, installedAt: new Date() };
    await this.recordAgent(server.id, result);

    return {
      serverId: server.id,
      outcome: alreadyActive ? 'ALREADY_ACTIVE' : 'INSTALLED',
      agent: result,
    };
  }

  /**
   * Чтение состояния. Проверка результата обязательна: ненулевой код или
   * нераспознанный протокол — это 424 READ_FAILED, а не «агент не установлен».
   */
  private async readAgent(
    session: SshSession,
    server: Server,
  ): Promise<AgentResponse> {
    const res = await this.execOr424(
      session,
      buildAgentReadCommand(),
      this.cfg.ssh.commandTimeoutMs,
    );
    const state = parseAgentState(res.stdout);
    const { status, errorCode } = agentStatusOf(
      state,
      this.cfg.ssh.heartbeatStaleSec,
      { workspaceId: server.workspaceId, serverId: server.id },
    );
    if (res.code !== 0 || errorCode === 'READ_FAILED') {
      throw new FailedDependencyException({
        errorCode: 'READ_FAILED',
        message: 'host did not return a readable agent state',
      });
    }
    return {
      serverId: server.id,
      status,
      version: state.manifest?.version ?? null,
      installedAt: server.agentInstalledAt,
      lastHeartbeatAt:
        state.heartbeatSec === null
          ? null
          : new Date(state.heartbeatSec * 1000),
      dockerVersion: server.dockerVersion,
      errorCode,
      checkedAt: new Date(),
    };
  }

  /**
   * Ось агента пишется целиком; ось доступности хоста — только факт успешного
   * удалённого вызова (раз команда исполнилась, хост ONLINE) (ревью №4).
   */
  private async recordAgent(
    serverId: string,
    agent: AgentResponse,
  ): Promise<void> {
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status: ServerStatus.ONLINE,
        // Версию чужого агента (IDENTITY_MISMATCH) под свой сервер не пишем.
        agentVersion:
          agent.status === 'NOT_INSTALLED' ||
          agent.errorCode === 'IDENTITY_MISMATCH'
            ? null
            : agent.version,
        agentInstalledAt: agent.installedAt,
        lastAgentStatus: REPORT_STATUS[agent.status],
        lastAgentErrorCode: agent.errorCode,
        lastCheckedAt: agent.checkedAt,
      },
    });
  }

  private async recordAgentFailure(
    serverId: string,
    errorCode: SshErrorCode,
  ): Promise<void> {
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        // Скрипт отработал на хосте: SSH доступен, агент — нет.
        status: ServerStatus.ONLINE,
        lastAgentStatus: AgentReportStatus.FAILED,
        lastAgentErrorCode: errorCode,
        lastCheckedAt: new Date(),
      },
    });
  }

  private async execOr424(
    session: SshSession,
    command: string,
    timeoutMs: number,
  ): Promise<SshExecResult> {
    try {
      return await this.ssh.exec(session, command, timeoutMs);
    } catch (err) {
      const code = err instanceof SshFailure ? err.code : classifySshError(err);
      throw new FailedDependencyException({
        errorCode: code,
        message: 'server unreachable',
      });
    }
  }
}

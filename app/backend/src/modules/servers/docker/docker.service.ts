import {
  HttpStatus,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Dockerode from 'dockerode';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';
import { FailedDependencyException } from '../../../common/http/failed-dependency.exception';
import { UpstreamTimeoutException } from '../../../common/http/upstream-timeout.exception';
import {
  SSH_RUNNER,
  SshFailure,
  type DockerTransport,
  type SshErrorCode,
  type SshRunner,
  type SshSession,
} from '../ssh/ssh-runner';
import { createDockerode } from '../ssh/docker-agent';
import type { WorkspaceRole } from '@prisma/client';
import { MEMBER_ROLES, ServersService } from '../servers.service';
import { classifyDialFailure } from './docker-readiness';
import {
  toDetails,
  toSummary,
  type ContainerDetails,
  type ContainerSummary,
} from './container.types';

/** Ошибка docker-modem: HTTP-статус демона живёт в statusCode. */
interface DockerApiError {
  statusCode?: number;
  message?: string;
}

@Injectable()
export class DockerService {
  constructor(
    private readonly servers: ServersService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async list(
    userId: string,
    workspaceId: string,
    serverId: string,
    all: boolean,
  ): Promise<ContainerSummary[]> {
    return this.withDocker(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      (docker) =>
        docker.listContainers({ all }).then((rows) => rows.map(toSummary)),
    );
  }

  async details(
    userId: string,
    workspaceId: string,
    serverId: string,
    containerId: string,
  ): Promise<ContainerDetails> {
    return this.withDocker(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      (docker) => docker.getContainer(containerId).inspect().then(toDetails),
    );
  }

  /**
   * Одна аутентифицированная сессия = один SSH-коннект = одна dockerode на
   * время HTTP-запроса панели. Дедлайн считается здесь, а не только внутри
   * транспорта: зависший Docker API обязан отвалиться, а не держать запрос.
   */
  private async withDocker<T>(
    userId: string,
    workspaceId: string,
    serverId: string,
    roles: WorkspaceRole[],
    fn: (docker: Dockerode) => Promise<T>,
  ): Promise<T> {
    const { session } = await this.servers.loadForSsh(
      userId,
      workspaceId,
      serverId,
      roles,
      'authenticated',
    );
    const deadlineMs = this.cfg.ssh.commandTimeoutMs;
    const transport = await this.openTransport(session, deadlineMs);
    const docker = createDockerode(transport);

    let timer: NodeJS.Timeout | undefined;
    const call = fn(docker);
    // Если победит дедлайн, отказ брошенного вызова не должен становиться
    // unhandled rejection: запрос всё равно убивает close() в finally.
    call.catch(() => undefined);
    try {
      return await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new SshFailure('TIMEOUT', 'docker api deadline exceeded')),
            deadlineMs,
          );
          timer.unref();
        }),
      ]);
    } catch (err) {
      throw this.mapError(err, transport);
    } finally {
      if (timer) clearTimeout(timer);
      transport.close();
    }
  }

  private async openTransport(
    session: SshSession,
    deadlineMs: number,
  ): Promise<DockerTransport> {
    try {
      return await this.ssh.dockerTransport(session, deadlineMs);
    } catch (err) {
      if (err instanceof SshFailure) throw this.toHttp(err);
      throw err;
    }
  }

  /**
   * Маппинг сбоев (таблица в плане, P1-E): 404 — контейнера нет; 424 — проблема
   * зависимости (хост, демон); 504 — дедлайн; 500 — только дефект панели.
   */
  private mapError(err: unknown, transport: DockerTransport): Error {
    if (err instanceof SshFailure) return this.toHttp(err);

    const statusCode = (err as DockerApiError)?.statusCode;
    if (statusCode === HttpStatus.NOT_FOUND) {
      return new NotFoundException('container not found');
    }
    if (typeof statusCode === 'number' && statusCode >= 400) {
      return new FailedDependencyException({
        errorCode: 'DOCKER_UNREACHABLE',
        message: 'docker api call failed',
      });
    }

    // Канал `docker system dial-stdio` мог умереть до первого байта ответа:
    // тогда HTTP-статуса нет вовсе, а есть stderr и код выхода exec'а.
    const { stderr, code } = transport.failure;
    if (stderr !== '' || code !== null) {
      return new FailedDependencyException({
        errorCode: classifyDialFailure(
          stderr,
          code === null ? '' : `exit ${code}`,
        ),
        message: 'docker api is not reachable on this host',
      });
    }

    return new InternalServerErrorException('docker api call failed', {
      cause: err,
    });
  }

  private toHttp(err: SshFailure): HttpException {
    if (err.code === 'TIMEOUT') {
      return new UpstreamTimeoutException(err.message);
    }
    return new FailedDependencyException({
      errorCode: err.code satisfies SshErrorCode,
      message: err.message,
    });
  }
}

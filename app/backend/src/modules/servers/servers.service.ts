import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { utils } from 'ssh2';
import {
  AgentReportStatus,
  Prisma,
  Server,
  ServerAuthType,
  ServerStatus,
  WorkspaceRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { resolveTarget } from './ssh/network-policy';
import {
  SSH_RUNNER,
  SshFailure,
  type SshRunner,
  type SshSession,
} from './ssh/ssh-runner';
import type { CreateServerDto } from './dto/create-server.dto';

export const MEMBER_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.MEMBER,
];
export const OWNER_ONLY_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER];

export interface ServerResponse {
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
  agentVersion: string | null;
  agentInstalledAt: Date | null;
  lastAgentStatus: AgentReportStatus | null;
  lastAgentErrorCode: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Явный список полей — секрету тут взяться неоткуда. */
export function toServerResponse(server: Server): ServerResponse {
  return {
    id: server.id,
    workspaceId: server.workspaceId,
    name: server.name,
    host: server.host,
    port: server.port,
    sshUsername: server.sshUsername,
    authType: server.authType,
    status: server.status,
    hostKeyFingerprint: server.hostKeyFingerprint,
    dockerVersion: server.dockerVersion,
    agentVersion: server.agentVersion,
    agentInstalledAt: server.agentInstalledAt,
    lastAgentStatus: server.lastAgentStatus,
    lastAgentErrorCode: server.lastAgentErrorCode,
    lastCheckedAt: server.lastCheckedAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly credentials: CredentialCryptoService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateServerDto,
  ): Promise<ServerResponse> {
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );

    if (!this.cfg.ssh.allowedPorts.includes(dto.port)) {
      throw new BadRequestException('port is not allowed for ssh connections');
    }
    const secret =
      dto.authType === ServerAuthType.PASSWORD
        ? dto.sshPassword
        : dto.sshPrivateKey;
    if (dto.authType === ServerAuthType.KEY) {
      this.assertParseablePrivateKey(secret as string);
    }

    try {
      const server = await this.prisma.server.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          host: dto.host,
          port: dto.port,
          sshUsername: dto.sshUsername,
          authType: dto.authType,
          secretCipher: this.credentials.encrypt(secret as string),
        },
      });
      return toServerResponse(server);
    } catch (err) {
      throw this.mapConflict(err);
    }
  }

  async findAll(
    userId: string,
    workspaceId: string,
  ): Promise<ServerResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const servers = await this.prisma.server.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return servers.map(toServerResponse);
  }

  async findOne(
    userId: string,
    workspaceId: string,
    serverId: string,
  ): Promise<ServerResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    return toServerResponse(await this.requireRow(serverId, workspaceId));
  }

  /**
   * Скоупинг + политика + строка + сессия.
   * purpose='probe' — проверяем host key, креденшелы не отправляем;
   * 'authenticated' — требует уже принятый отпечаток.
   */
  async loadForSsh(
    userId: string,
    workspaceId: string,
    serverId: string,
    roles: WorkspaceRole[],
    purpose: 'probe' | 'authenticated',
  ): Promise<{ server: Server; session: SshSession }> {
    await this.workspaces.requireMembership(userId, workspaceId, roles);
    const server = await this.requireRow(serverId, workspaceId);

    if (purpose === 'authenticated' && !server.hostKeyFingerprint) {
      throw new FailedDependencyException({
        errorCode: 'HOST_KEY_NOT_TRUSTED',
        message: 'host key is not trusted yet',
      });
    }

    let address: string;
    try {
      ({ address } = await resolveTarget(server.host, server.port, {
        allowedPorts: this.cfg.ssh.allowedPorts,
        allowLoopback: this.cfg.ssh.allowLoopback,
      }));
    } catch (err) {
      if (!(err instanceof SshFailure)) throw err;
      throw new FailedDependencyException({
        errorCode: err.code,
        message: err.message,
      });
    }

    let secret: string;
    try {
      secret = this.credentials.decrypt(server.secretCipher);
    } catch {
      throw new InternalServerErrorException('server credential unreadable');
    }

    // Write-on-read: единственное место, где чтение порождает запись. Без него
    // ротация ключа требовала бы офлайн-джобы, которой в MVP нет.
    if (this.credentials.needsRewrap(server.secretCipher)) {
      await this.prisma.server.update({
        where: { id: server.id },
        data: { secretCipher: this.credentials.encrypt(secret) },
      });
    }

    return {
      server,
      session: {
        host: server.host,
        address,
        port: server.port,
        username: server.sshUsername,
        authType: server.authType,
        secret,
        expectedHostKeyFingerprint:
          purpose === 'probe' ? null : server.hostKeyFingerprint,
      },
    };
  }

  /** И «нет строки», и «строка чужого воркспейса» — 404 без различия. */
  private async requireRow(
    serverId: string,
    workspaceId: string,
  ): Promise<Server> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, workspaceId },
    });
    if (!server) throw new NotFoundException();
    return server;
  }

  /**
   * Структурная проверка ключа парсером ssh2: node:crypto НЕ читает OpenSSH-формат,
   * а именно его выдаёт современный ssh-keygen. Проверено прогоном: parseKey
   * разбирает OpenSSH и PKCS#1, падает на мусоре и на pkcs8, а на зашифрованном
   * ключе сообщает про passphrase.
   */
  private assertParseablePrivateKey(pem: string): void {
    const parsed: unknown = utils.parseKey(pem);
    const first: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!(first instanceof Error)) return;
    if (first.message.includes('Encrypted')) {
      throw new BadRequestException('encrypted private keys are not supported');
    }
    throw new BadRequestException('sshPrivateKey is not a valid private key');
  }

  private mapConflict(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const target = (err.meta?.['target'] ?? []) as string[];
      if (target.includes('hostKeyFingerprint')) {
        return new ConflictException(
          'host key already registered for another server',
        );
      }
      return new ConflictException(
        'server name already used in this workspace',
      );
    }
    return err as Error;
  }
}

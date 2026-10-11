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
import { classifySshError } from './ssh/classify-ssh-error';
import { resolveTarget } from './ssh/network-policy';
import { buildDockerVersionCommand } from './agent/agent-script';
import { buildOsProbeCommand, parseOsName } from './agent/os-probe';
import {
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh/ssh-runner';
import type { CreateServerDto } from './dto/create-server.dto';
import type { TestConnectionDto } from './dto/test-connection.dto';
import {
  SEARCH_LIMIT_DEFAULT,
  type SearchServersDto,
} from './dto/search-servers.dto';
import type { TestServerDto } from './dto/test-server.dto';
import {
  SERVER_SEARCH,
  type ServerSearchPort,
} from '../search/server-search.service';
import {
  CursorPage,
  CursorPaginationDto,
  DEFAULT_PAGE_LIMIT,
  decodeCursorOrThrow,
  encodeCursor,
  takePage,
} from '../../common/dto/cursor-pagination.dto';

export const MEMBER_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.MEMBER,
];
export const OWNER_ONLY_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER];

export interface ServerTestResponse {
  /** null у test-connection (draft): строки в БД ещё нет. */
  serverId: string | null;
  reachable: boolean;
  trustRequired: boolean;
  status: ServerStatus;
  latencyMs: number;
  dockerVersion: string | null;
  dockerErrorCode: SshErrorCode | null;
  errorCode: SshErrorCode | null;
  hostKeyFingerprint: string | null;
  /** Эффективное значение после пробы: свежее или ранее сохранённое. */
  osName: string | null;
  checkedAt: Date;
}

/** Вывод docker-version принимаем только как NN[.NN]*(-rc)? — не произвольный текст хоста. */
const DOCKER_VERSION_RE = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.]+)?$/;

/** Почему Docker не отвечает — три разных диагноза, не один «DOCKER_MISSING» (ревью №5). */
export function classifyDockerFailure(
  code: number | null,
  stderr: string,
): SshErrorCode {
  const lower = stderr.toLowerCase();
  if (code === 127 || lower.includes('command not found')) {
    return 'DOCKER_MISSING';
  }
  if (lower.includes('permission denied')) return 'DOCKER_PERMISSION_DENIED';
  if (lower.includes('cannot connect to the docker daemon')) {
    return 'DOCKER_SOCKET_UNREACHABLE';
  }
  return 'COMMAND_FAILED';
}

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
  osName: string | null;
  agentVersion: string | null;
  agentInstalledAt: Date | null;
  lastAgentStatus: AgentReportStatus | null;
  lastAgentErrorCode: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerSearchResponse {
  items: ServerResponse[];
  total: number;
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
    osName: server.osName,
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
    @Inject(SERVER_SEARCH) private readonly search: ServerSearchPort,
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
          // Пин из мастера (test-connection) сохраняется сразу: подтверждение
          // отпечатка — явное действие владельца, а не побочный эффект теста.
          hostKeyFingerprint: dto.hostKeyFingerprint ?? null,
        },
      });
      // Индекс — вспомогательная копия: сбой движка не должен валить создание.
      this.search.syncServer(server);
      return toServerResponse(server);
    } catch (err) {
      throw this.mapConflict(err);
    }
  }

  async findAll(
    userId: string,
    workspaceId: string,
    q: CursorPaginationDto,
  ): Promise<CursorPage<ServerResponse>> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    // Keyset (createdAt, id) — тот же паттерн, что findAllForUser.
    const limit = q.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = q.cursor ? decodeCursorOrThrow(q.cursor) : null;
    const cursorTs = cursor ? new Date(cursor.ts) : null;
    const servers = await this.prisma.server.findMany({
      where: {
        workspaceId,
        ...(cursor && cursorTs
          ? {
              OR: [
                { createdAt: { gt: cursorTs } },
                { createdAt: cursorTs, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = takePage(servers, limit, (s) =>
      encodeCursor(s.createdAt, s.id),
    );
    return {
      items: page.items.map(toServerResponse),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Поиск по индексу: порядок — релевантность движка, права — как у списка.
   * `dto` уже провалидирован контроллером; дефолт лимита — здесь, чтобы спеки
   * и спека маршрута видели одно число.
   */
  async searchServers(
    userId: string,
    workspaceId: string,
    dto: SearchServersDto,
  ): Promise<ServerSearchResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const { items, total } = await this.search.searchServers(
      workspaceId,
      dto.q,
      dto.limit ?? SEARCH_LIMIT_DEFAULT,
    );
    return { items: items.map(toServerResponse), total };
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
   * POST .../test. Недоступный хост — легитимный результат (200 reachable:false),
   * а не ошибка клиента; 5xx остаётся только внутренним сбоям (БД, код).
   */
  async testConnection(
    userId: string,
    workspaceId: string,
    serverId: string,
    dto: TestServerDto,
  ): Promise<ServerTestResponse> {
    const startedAt = Date.now();
    const checkedAt = new Date();

    // Пина нет — сначала probe: при expectedHostKeyFingerprint === null верификатор
    // всегда возвращает false, поэтому аутентификации на этом шаге не происходит.
    const probe = await this.loadForSsh(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      'probe',
    );
    if (!probe.server.hostKeyFingerprint) {
      let failure: SshFailure | null = null;
      try {
        await this.ssh.exec(
          probe.session,
          'true',
          this.cfg.ssh.connectTimeoutMs,
        );
      } catch (err) {
        if (!(err instanceof SshFailure)) throw err;
        failure = err;
      }

      const observed = failure?.observedHostKeyFingerprint ?? null;
      if (observed === null) {
        // Рукопожатие не дошло до ключа хоста: это сетевой отказ, а не «ключ не подтверждён».
        await this.recordProbe(serverId, ServerStatus.OFFLINE, null, checkedAt);
        return this.unreachableResult(
          serverId,
          failure ??
            new SshFailure('NETWORK', 'host key probe observed no host key'),
          Date.now() - startedAt,
          checkedAt,
          probe.server.osName,
        );
      }

      if (!dto.trustHostKey) {
        await this.saveProbe(serverId, { lastCheckedAt: checkedAt });
        return {
          serverId,
          reachable: false,
          trustRequired: true,
          status: probe.server.status,
          latencyMs: Date.now() - startedAt,
          dockerVersion: null,
          dockerErrorCode: null,
          errorCode: 'HOST_KEY_NOT_TRUSTED',
          hostKeyFingerprint: observed,
          osName: probe.server.osName,
          checkedAt,
        };
      }
      if (dto.trustHostKey !== observed) {
        throw new ConflictException('host key fingerprint does not match');
      }
      await this.pinHostKey(serverId, observed, checkedAt);
    }

    const { server, session } = await this.loadForSsh(
      userId,
      workspaceId,
      serverId,
      MEMBER_ROLES,
      'authenticated',
    );

    let exec: SshExecResult;
    try {
      exec = await this.ssh.exec(
        session,
        buildDockerVersionCommand(),
        this.cfg.ssh.commandTimeoutMs,
      );
    } catch (err) {
      await this.recordProbe(serverId, ServerStatus.OFFLINE, null, checkedAt);
      return this.unreachableResult(
        serverId,
        err,
        Date.now() - startedAt,
        checkedAt,
        server.osName,
      );
    }

    // Проба ОС идёт в обеих ветках: система и Docker — независимые оси, и карточка
    // показывает ОС даже у хоста без Docker. Сбой пробы вердикт не меняет.
    const probedOsName = await this.probeOsName(session);
    const osName = probedOsName ?? server.osName;

    const latencyMs = Date.now() - startedAt;
    const hostKeyFingerprint = server.hostKeyFingerprint;
    if (exec.code !== 0) {
      // Хост доступен, Docker — нет: это разные оси, статус остаётся ONLINE.
      const dockerErrorCode = classifyDockerFailure(exec.code, exec.stderr);
      await this.recordProbe(
        serverId,
        ServerStatus.ONLINE,
        null,
        checkedAt,
        probedOsName,
      );
      return {
        serverId,
        reachable: true,
        trustRequired: false,
        status: ServerStatus.ONLINE,
        latencyMs,
        dockerVersion: null,
        dockerErrorCode,
        errorCode: null,
        hostKeyFingerprint,
        osName,
        checkedAt,
      };
    }

    const candidate = exec.stdout.trim();
    const dockerVersion = DOCKER_VERSION_RE.test(candidate)
      ? candidate.slice(0, 32)
      : null;
    await this.recordProbe(
      serverId,
      ServerStatus.ONLINE,
      dockerVersion,
      checkedAt,
      probedOsName,
    );
    return {
      serverId,
      reachable: true,
      trustRequired: false,
      status: ServerStatus.ONLINE,
      latencyMs,
      dockerVersion,
      dockerErrorCode: null,
      errorCode: null,
      hostKeyFingerprint,
      osName,
      checkedAt,
    };
  }

  /**
   * POST .../test-connection: тот же SSH-путь, что у test, но по данным формы —
   * строка в БД не создаётся (ни пина, ни статуса, ни пробы). TOFU как обычно:
   * первый ответ trustRequired, подтверждённый отпечаток приходит в trustHostKey,
   * а возвращённый hostKeyFingerprint мастер отдаёт в create, чтобы сервер
   * родился уже доверенным.
   */
  async testConnectionDraft(
    userId: string,
    workspaceId: string,
    dto: TestConnectionDto,
  ): Promise<ServerTestResponse> {
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

    const startedAt = Date.now();
    const checkedAt = new Date();

    let address: string;
    try {
      ({ address } = await resolveTarget(dto.host, dto.port, {
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

    // Проба: expectedHostKeyFingerprint === null — креденшелы не отправляются.
    const session: SshSession = {
      host: dto.host,
      address,
      port: dto.port,
      username: dto.sshUsername,
      authType: dto.authType,
      secret: secret as string,
      expectedHostKeyFingerprint: null,
    };
    let failure: SshFailure | null = null;
    try {
      await this.ssh.exec(session, 'true', this.cfg.ssh.connectTimeoutMs);
    } catch (err) {
      if (!(err instanceof SshFailure)) throw err;
      failure = err;
    }

    const observed = failure?.observedHostKeyFingerprint ?? null;
    if (observed === null) {
      return this.unreachableResult(
        null,
        failure ??
          new SshFailure('NETWORK', 'host key probe observed no host key'),
        Date.now() - startedAt,
        checkedAt,
        null,
      );
    }
    if (!dto.trustHostKey) {
      return {
        serverId: null,
        reachable: false,
        trustRequired: true,
        status: ServerStatus.PENDING,
        latencyMs: Date.now() - startedAt,
        dockerVersion: null,
        dockerErrorCode: null,
        errorCode: 'HOST_KEY_NOT_TRUSTED',
        hostKeyFingerprint: observed,
        osName: null,
        checkedAt,
      };
    }
    if (dto.trustHostKey !== observed) {
      throw new ConflictException('host key fingerprint does not match');
    }

    const pinnedSession: SshSession = {
      ...session,
      expectedHostKeyFingerprint: observed,
    };
    let exec: SshExecResult;
    try {
      exec = await this.ssh.exec(
        pinnedSession,
        buildDockerVersionCommand(),
        this.cfg.ssh.commandTimeoutMs,
      );
    } catch (err) {
      return this.unreachableResult(
        null,
        err,
        Date.now() - startedAt,
        checkedAt,
        null,
      );
    }

    const osName = await this.probeOsName(pinnedSession);
    const latencyMs = Date.now() - startedAt;
    if (exec.code !== 0) {
      return {
        serverId: null,
        reachable: true,
        trustRequired: false,
        status: ServerStatus.ONLINE,
        latencyMs,
        dockerVersion: null,
        dockerErrorCode: classifyDockerFailure(exec.code, exec.stderr),
        errorCode: null,
        hostKeyFingerprint: observed,
        osName,
        checkedAt,
      };
    }

    const candidate = exec.stdout.trim();
    return {
      serverId: null,
      reachable: true,
      trustRequired: false,
      status: ServerStatus.ONLINE,
      latencyMs,
      dockerVersion: DOCKER_VERSION_RE.test(candidate)
        ? candidate.slice(0, 32)
        : null,
      dockerErrorCode: null,
      errorCode: null,
      hostKeyFingerprint: observed,
      osName,
      checkedAt,
    };
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

  private unreachableResult(
    serverId: string | null,
    err: unknown,
    latencyMs: number,
    checkedAt: Date,
    osName: string | null,
  ): ServerTestResponse {
    const failure = err instanceof SshFailure ? err : null;
    return {
      serverId,
      reachable: false,
      trustRequired: false,
      status: ServerStatus.OFFLINE,
      latencyMs,
      dockerVersion: null,
      dockerErrorCode: null,
      errorCode: failure ? failure.code : classifySshError(err),
      hostKeyFingerprint: failure?.observedHostKeyFingerprint ?? null,
      osName,
      checkedAt,
    };
  }

  /**
   * Проба ОС — вспомогательная ось: и отказ канала, и нераспознанный вывод дают
   * null, чтобы вердикт о хосте не зависел от доступности hostnamectl/uname.
   */
  private async probeOsName(session: SshSession): Promise<string | null> {
    try {
      const exec = await this.ssh.exec(
        session,
        buildOsProbeCommand(),
        this.cfg.ssh.commandTimeoutMs,
      );
      return parseOsName(exec.stdout);
    } catch {
      return null;
    }
  }

  private async recordProbe(
    serverId: string,
    status: ServerStatus,
    dockerVersion: string | null,
    checkedAt: Date,
    osName: string | null = null,
  ): Promise<void> {
    await this.saveProbe(serverId, {
      status,
      dockerVersion,
      lastCheckedAt: checkedAt,
      // Проба не удалась — ранее записанное имя ОС не затирается.
      ...(osName !== null ? { osName } : {}),
    });
  }

  /** Сбой персистентности — это 500, а не «хост недоступен» (ревью №7). */
  private async saveProbe(
    serverId: string,
    data: Prisma.ServerUpdateInput,
  ): Promise<void> {
    try {
      await this.prisma.server.update({ where: { id: serverId }, data });
    } catch (err) {
      throw new InternalServerErrorException(
        'server probe result could not be saved',
        { cause: err },
      );
    }
  }

  /**
   * Пин может нарушить `@@unique([workspaceId, hostKeyFingerprint])` — это
   * предсказуемый конфликт данных (409), а не сбой БД (500), как в saveProbe.
   */
  private async pinHostKey(
    serverId: string,
    fingerprint: string,
    checkedAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.server.update({
        where: { id: serverId },
        data: { hostKeyFingerprint: fingerprint, lastCheckedAt: checkedAt },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.mapConflict(err);
      }
      throw new InternalServerErrorException(
        'server host key could not be saved',
        {
          cause: err,
        },
      );
    }
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

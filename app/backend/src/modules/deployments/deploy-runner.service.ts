import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DeploymentStatus, Prisma } from '@prisma/client';
import { FailedDependencyException } from '../../common/http/failed-dependency.exception';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { OWNER_ONLY_ROLES, ServersService } from '../servers/servers.service';
import {
  SSH_RUNNER,
  SshFailure,
  type SshErrorCode,
  type SshRunner,
  type SshSession,
} from '../servers/ssh/ssh-runner';
import {
  buildDeployPlan,
  deployCodeOfSsh,
  deployErrorCodeOf,
  deployPaths,
  parseStepResult,
  toPrismaStep,
} from './deploy-script';
import {
  toDeploySnapshot,
  type DeployErrorCode,
  type DeployStepName,
} from './deployment.types';

export type DeploymentJob = Prisma.DeploymentGetPayload<{
  include: { project: true; config: true };
}>;

/**
 * Ожидаемый отказ исполнителя: диагноз уже известен, осталось закрыть строку.
 * `detail` пустой для проваленного шага — хвост лога уже в journal, второй раз
 * тот же текст в журнал класть не нужно.
 */
class DeployAbort extends Error {
  constructor(
    readonly errorCode: DeployErrorCode,
    readonly exitCode: number | null,
    readonly detail = '',
  ) {
    super(errorCode);
    this.name = 'DeployAbort';
  }
}

interface Journal {
  log: string;
  step: DeployStepName | null;
  commitSha: string | null;
  imageTag: string | null;
  containerId: string | null;
}

const ORPHAN_NOTE =
  '\n===== INTERRUPTED =====\nпанель перезапустилась; задача не продолжена и не перезапущена автоматически\n';

@Injectable()
export class DeployRunnerService implements OnModuleInit {
  private readonly logger = new Logger(DeployRunnerService.name);
  private readonly inflight = new Set<Promise<void>>();
  /**
   * Ход движка (tick), который идёт прямо сейчас. Поле нужно для `drain()`:
   * `pump()` возвращает управление синхронно, и без него наблюдатель ждал бы
   * пустого `inflight`, потому что слот ещё не зарезервирован.
   */
  private ticking: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    @Inject(SSH_RUNNER) private readonly ssh: SshRunner,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const released = await this.reconcile();
    if (released > 0) {
      this.logger.warn(
        `${released} deploy job(s) were left by the previous process and marked INTERRUPTED`,
      );
    }
  }

  /**
   * In-process исполнитель умирает вместе с панелью, и по продолжению работы
   * отличить «идёт» от «осиротело» нельзя: честный диагноз один — INTERRUPTED,
   * без автоперезапуска (решение владельца). Строка, простоявшая в очереди,
   * уходит в `INTERRUPTED` с `durationMs = null`: времени исполнения у неё не
   * было, и выдуманная длительность была бы хуже пустого поля.
   */
  async reconcile(): Promise<number> {
    const orphans = await this.prisma.deployment.findMany({
      where: {
        status: { in: [DeploymentStatus.QUEUED, DeploymentStatus.RUNNING] },
      },
      select: { id: true, startedAt: true, log: true },
    });
    for (const orphan of orphans) {
      const finishedAt = new Date();
      await this.prisma.deployment.update({
        where: { id: orphan.id },
        data: {
          status: DeploymentStatus.INTERRUPTED,
          errorCode: 'PANEL_RESTARTED',
          finishedAt,
          // без этого слот конфигурации остался бы занят навсегда
          activeConfigId: null,
          durationMs: orphan.startedAt
            ? finishedAt.getTime() - orphan.startedAt.getTime()
            : null,
          log: `${orphan.log}${ORPHAN_NOTE}`,
        },
      });
    }
    return orphans.length;
  }

  /**
   * Единственная точка, из которой HTTP-слой разрешает исполнение: поднять
   * столько `QUEUED`-задач, сколько свободных слотов (`deploy.maxParallel`),
   * начиная с самой старой. Не «запусти вот этот id»: очередь — состояние БД, а
   * не имя задачи, и параллельные POST не должны складывать N сборок в одном
   * процессе.
   */
  pump(): void {
    if (this.ticking) return;
    this.ticking = this.tick()
      .catch((err: unknown) => {
        this.logger.error(`deploy pump failed: ${String(err)}`);
      })
      .finally(() => {
        this.ticking = null;
      });
  }

  private async tick(): Promise<void> {
    while (this.inflight.size < this.cfg.deploy.maxParallel) {
      const [next] = await this.prisma.deployment.findMany({
        where: { status: DeploymentStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
        take: 1,
      });
      if (!next) return;
      const tracked = this.run(next.id)
        .catch((err: unknown) => {
          // run сам закрывает строку в БД; сюда долетает только собственный
          // дефект панели (например, упавший finalize)
          this.logger.error(`deploy ${next.id} escaped its own error handling`);
          this.logger.debug(String(err));
        })
        .finally(() => {
          this.inflight.delete(tracked);
          this.pump();
        });
      // Резерв слота синхронно после await: между проверкой размера и add нет
      // точки переключения, поэтому два tick не возьмут один и тот же слот.
      this.inflight.add(tracked);
    }
  }

  /** Дождаться всего, что запущено этим процессом (тесты, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.ticking || this.inflight.size > 0) {
      // `ticking` может породить новые `inflight`, а их finalize — новый ход
      // движка, поэтому один `Promise.allSettled` не был бы точкой покоя.
      await (this.ticking ?? Promise.allSettled([...this.inflight]));
    }
  }

  /**
   * Публичный ожидаемый проход: Claim → четыре шага → finalize. Обязан закрыть
   * строку на любом исходе, включая собственный дефект панели.
   */
  async run(deploymentId: string): Promise<void> {
    const startedAt = new Date();
    const claimed = await this.prisma.deployment.updateMany({
      where: { id: deploymentId, status: DeploymentStatus.QUEUED },
      data: { status: DeploymentStatus.RUNNING, startedAt },
    });
    if (claimed.count !== 1) return;

    const job = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true, config: true },
    });
    // Cascade-FK (Task 1) убирают проект/конфигурацию вместе с задачей, поэтому
    // отсутствие строки здесь — только гонка удаления между claim и чтением.
    if (!job) return;

    const journal: Journal = {
      log: job.log,
      step: null,
      commitSha: job.commitSha,
      imageTag: job.imageTag,
      containerId: job.containerId,
    };

    try {
      await this.execute(job, journal);
      await this.finalize(job, startedAt, journal, {
        status: DeploymentStatus.SUCCESS,
        errorCode: null,
        exitCode: null,
      });
    } catch (err) {
      const abort = err instanceof DeployAbort ? err : null;
      journal.log += abort ? abort.detail : `\n${this.text(err)}`;
      await this.finalize(job, startedAt, journal, {
        status: DeploymentStatus.FAILED,
        errorCode: abort ? abort.errorCode : this.unexpectedCode(err),
        exitCode: abort ? abort.exitCode : null,
      });
    }
  }

  private async execute(job: DeploymentJob, journal: Journal): Promise<void> {
    const imageTag = `bios-deploy:${job.id}`;

    // «Что деплоить» — из снимка, сделанного при постановке в очередь. Живая
    // конфигурация к моменту старта могла измениться; обещание пользователя уже
    // дано, и исполнять надо его.
    const snapshot = toDeploySnapshot(job.snapshot);
    if (snapshot === null) {
      throw new DeployAbort('SNAPSHOT_INVALID', null, '\nsnapshot unreadable');
    }

    let session: SshSession;
    let root: boolean;
    try {
      const loaded = await this.servers.loadForSsh(
        job.triggeredById,
        job.project.workspaceId,
        job.config.serverId,
        OWNER_ONLY_ROLES,
        'authenticated',
      );
      session = loaded.session;
      // то же правило, что у установки агента (agent.service.ts): root не требует sudo
      root = loaded.server.sshUsername === 'root';
    } catch (err) {
      // ни одной удалённой команды не отправлено; текст 424 — единственная
      // зацепка в журнале, поэтому он уходит в detail
      throw new DeployAbort(this.accessCode(err), null, `\n${this.text(err)}`);
    }

    const plan = buildDeployPlan({
      paths: deployPaths(this.cfg.deploy.rootDir, job.projectId, job.configId),
      root,
      repoUrl: snapshot.repoUrl,
      ref: snapshot.ref,
      dockerfile: snapshot.dockerfile,
      imageTag,
      containerName: snapshot.containerName,
      ports: snapshot.ports,
      logTailBytes: this.cfg.deploy.logTailBytes,
      hostLogBytes: this.cfg.deploy.hostLogBytes,
    });

    for (const entry of plan) {
      journal.step = entry.step;
      // Шаг пишется ДО его исполнения: `GET /deployments/:id` во время
      // минутной сборки должен показывать `build`, а не последний завершённый
      // шаг. Значения (SHA/CID) по-прежнему пишутся только с подтверждённого
      // шага — см. конец итерации.
      await this.prisma.deployment.update({
        where: { id: job.id },
        data: { step: toPrismaStep(entry.step) },
      });
      let stdout = '';
      let stderr = '';
      let code: number | null = null;
      try {
        const res = await this.ssh.exec(
          session,
          entry.command,
          this.cfg.deploy.stepTimeoutMs,
        );
        stdout = res.stdout;
        stderr = res.stderr;
        code = res.code;
      } catch (err) {
        // node-ssh.runner обязан оборачивать любой сбой в SshFailure, поэтому
        // сырая ошибка от шва — дефект панели, а не хоста: врать про недоступный
        // хост она не имеет права.
        const errorCode: DeployErrorCode =
          err instanceof SshFailure
            ? deployCodeOfSsh(err.code)
            : 'COMMAND_FAILED';
        throw new DeployAbort(
          errorCode,
          null,
          `\n${entry.step}: ${this.text(err)}`,
        );
      }

      const result = parseStepResult(stdout, stderr, code);
      journal.log += `\n===== ${entry.step} =====\n${result.log}`;

      const errorCode = deployErrorCodeOf(entry.step, result);
      if (errorCode !== null) {
        // хвост шага уже в journal — второй раз его класть некуда и незачем
        throw new DeployAbort(errorCode, result.code);
      }

      // Значения пишутся только с подтверждённого шага: маркер SHA у source,
      // CID у run, а imageTag — тег, который мы сами попросили docker проставить.
      if (entry.step === 'source')
        journal.commitSha = result.markers.SHA ?? null;
      if (entry.step === 'build') journal.imageTag = imageTag;
      if (entry.step === 'run')
        journal.containerId = result.markers.CID ?? null;
      await this.progress(job.id, journal);
    }
  }

  /**
   * Прогресс пишется после каждого шага: `GET /deployments/:id` должен
   * показывать живую картину, а не только финал.
   */
  private async progress(
    deploymentId: string,
    journal: Journal,
  ): Promise<void> {
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        step: journal.step ? toPrismaStep(journal.step) : undefined,
        log: journal.log,
        commitSha: journal.commitSha,
        imageTag: journal.imageTag,
        containerId: journal.containerId,
      },
    });
  }

  private async finalize(
    job: DeploymentJob,
    startedAt: Date,
    journal: Journal,
    outcome: {
      status: DeploymentStatus;
      errorCode: DeployErrorCode | null;
      exitCode: number | null;
    },
  ): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.deployment.update({
      where: { id: job.id },
      data: {
        status: outcome.status,
        step: journal.step ? toPrismaStep(journal.step) : undefined,
        log: journal.log,
        commitSha: journal.commitSha,
        imageTag: journal.imageTag,
        containerId: journal.containerId,
        errorCode: outcome.errorCode,
        exitCode: outcome.exitCode,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        activeConfigId: null,
      },
    });
  }

  /**
   * Отказ до первой удалённой команды. `loadForSsh` говорит на языке HTTP:
   * 424 с кодом SSH — это диагноз хоста, 403/404 — потерянный доступ,
   * всё остальное (например, нечитаемый секрет) — дефект панели, а не деплоя.
   */
  private accessCode(err: unknown): DeployErrorCode {
    if (err instanceof FailedDependencyException) {
      const body = err.getResponse() as { errorCode?: SshErrorCode };
      return deployCodeOfSsh(body.errorCode ?? 'HOST_KEY_NOT_TRUSTED');
    }
    if (err instanceof SshFailure) return deployCodeOfSsh(err.code);
    if (err instanceof HttpException) {
      const status = err.getStatus();
      if (status === 403 || status === 404 || status === 401) {
        return 'ACCESS_LOST';
      }
    }
    return 'COMMAND_FAILED';
  }

  private unexpectedCode(err: unknown): DeployErrorCode {
    if (err instanceof SshFailure) return deployCodeOfSsh(err.code);
    return 'COMMAND_FAILED';
  }

  private text(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

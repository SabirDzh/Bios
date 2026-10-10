import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  SshFailure,
  type DockerTransport,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh-runner';

type Reply =
  | { kind: 'result'; match: RegExp; result: SshExecResult; used: boolean }
  | { kind: 'failure'; match: RegExp; error: Error; used: boolean };

/**
 * Детерминированный двойной SSH-канала: помнит сессии и команды, отвечает по regex.
 * Каждый зарекаенный ответ расходуется один раз (FIFO среди подходящих) — иначе
 * нельзя выразить «до установки / после установки».
 */
export class FakeSshRunner implements SshRunner {
  readonly commands: string[] = [];
  readonly sessions: SshSession[] = [];
  /** Хосты, по которым ходил probe (host key проверялся без креденшелов). */
  readonly probes: string[] = [];

  // --- Docker API: мок-демон на loopback, чтобы DockerService тестировался с
  // настоящей dockerode, но без демона и без SSH. ---
  /** JSON-ответ по пути без query ('/containers/json', '/containers/x/json'). */
  dockerRoutes: Record<string, unknown> = {};
  /** Сырые байты по пути — для логов (мультиплексированные фреймы). */
  dockerRawBodies: Record<string, Buffer> = {};
  /** Полный запрос с методом И query: тест видит `GET /containers/json?all=true`. */
  readonly dockerRequests: string[] = [];
  /** Демон молчит по этому префиксу: проверка дедлайна, а не «зависший тест». */
  dockerHangPrefix: string | null = null;
  /** Дедлайны, которые сервис просил у транспорта (по типу операции). */
  readonly transportDeadlineMs: number[] = [];
  transportsOpened = 0;
  transportsClosed = 0;
  private readonly replies: Reply[] = [];

  respond(
    match: RegExp,
    stdout: string,
    opts: { code?: number; stderr?: string } = {},
  ): this {
    this.replies.push({
      kind: 'result',
      match,
      used: false,
      result: { stdout, stderr: opts.stderr ?? '', code: opts.code ?? 0 },
    });
    return this;
  }

  fail(match: RegExp, error: Error): this {
    this.replies.push({ kind: 'failure', match, error, used: false });
    return this;
  }

  /** Заранее зарекаенный host-key-сценарий: наблюдаемый отпечаток + код ошибки. */
  hostKey(
    match: RegExp,
    observed: string,
    code: 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH',
  ): this {
    return this.fail(
      match,
      new SshFailure(code, 'host key is not trusted', observed),
    );
  }

  exec(session: SshSession, command: string): Promise<SshExecResult> {
    this.sessions.push(session);
    this.commands.push(command);
    if (session.expectedHostKeyFingerprint === null) {
      this.probes.push(session.host);
    }
    const hit = this.replies.find((r) => !r.used && r.match.test(command));
    if (!hit) {
      return Promise.reject(
        new Error(
          `FakeSshRunner: no scripted reply left for remote command\n${command}`,
        ),
      );
    }
    hit.used = true;
    return hit.kind === 'failure'
      ? Promise.reject(hit.error)
      : Promise.resolve(hit.result);
  }

  async dockerTransport(
    session: SshSession,
    deadlineMs: number,
  ): Promise<DockerTransport> {
    this.sessions.push(session);
    this.transportDeadlineMs.push(deadlineMs);
    if (session.expectedHostKeyFingerprint === null) {
      throw new SshFailure(
        'HOST_KEY_NOT_TRUSTED',
        'host key is not trusted yet',
      );
    }
    const port = await this.ensureMock();
    this.transportsOpened += 1;
    let closed = false;
    const agent = new http.Agent({ keepAlive: false });
    const createConnection: NonNullable<
      Pick<http.Agent, 'createConnection'>['createConnection']
    > = (_options, callback) => {
      const done = callback ?? (() => undefined);
      if (closed) {
        done(
          new SshFailure('DOCKER_UNREACHABLE', 'docker transport is closed'),
          null as never,
        );
        return undefined;
      }
      done(null, net.connect(port, '127.0.0.1'));
      return undefined;
    };
    agent.createConnection = createConnection;
    return {
      agent,
      get dead(): boolean {
        return closed;
      },
      close: (): void => {
        closed = true;
        this.transportsClosed += 1;
        agent.destroy();
      },
    };
  }

  private mock: http.Server | null = null;
  private mockPort = 0;

  private async ensureMock(): Promise<number> {
    if (this.mockPort) return this.mockPort;
    const server = http.createServer((req, res) => {
      const url = req.url ?? '';
      const path = url.split('?')[0];
      const full = `${req.method} ${url}`;
      this.dockerRequests.push(full);
      if (this.dockerHangPrefix && full.startsWith(this.dockerHangPrefix)) {
        return; // демон не отвечает: живое доказательство работы дедлайна
      }
      const raw = this.dockerRawBodies[path];
      if (raw) {
        res.end(raw);
        return;
      }
      const body = this.dockerRoutes[path];
      if (body === undefined) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'no such container' }));
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    this.mock = server;
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    this.mockPort = (server.address() as AddressInfo).port;
    return this.mockPort;
  }

  /**
   * Очистка между тестами: двойник создаётся один раз на прогон (DI-override в
   * beforeAll), иначе накопленные команды, ответы и скрипты Docker API
   * просачиваются в следующий тест.
   */
  reset(): void {
    this.commands.length = 0;
    this.sessions.length = 0;
    this.probes.length = 0;
    this.replies.length = 0;
    this.dockerRoutes = {};
    this.dockerRawBodies = {};
    this.dockerRequests.length = 0;
    this.transportDeadlineMs.length = 0;
    this.dockerHangPrefix = null;
    this.transportsOpened = 0;
    this.transportsClosed = 0;
  }

  /** Секрет не имеет права появляться в тексте удалённой команды. */
  assertNoSecretLeak(secret: string): void {
    if (this.commands.some((command) => command.includes(secret))) {
      throw new Error('remote command contains the credential');
    }
  }
}

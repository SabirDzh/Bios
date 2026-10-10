import http from 'node:http';
import Dockerode from 'dockerode';
import type { Client } from 'ssh2';
import { SshFailure, type DockerTransport } from './ssh-runner';

export const DOCKER_DIAL_COMMAND = 'docker system dial-stdio';

/** Хвост stderr канала: диагноз «Docker недоступен» целиком влезает с запасом. */
const STDERR_TAIL_BYTES = 2048;

type Cause = 'closed' | 'deadline';

/**
 * Один ssh2-коннект под много вызовов Docker API: каждый HTTP-запрос получает
 * отдельный exec-канал `docker system dial-stdio`, соединение не пересоздаётся
 * (промерено: handshake ~50 мс, все последующие вызовы +0 коннектов).
 *
 * Дедлайн ставится на ВСЮ операцию, а не только на рукопожатие: зависший демон
 * обязан отвалиться с TIMEOUT, а не держать запрос панели открытым.
 */
export class DockerSshTransport implements DockerTransport {
  readonly agent: http.Agent;
  private timer: NodeJS.Timeout | null = null;
  private cause: Cause | null = null;
  private stderrTail = '';
  private exitCode: number | null = null;

  constructor(
    private readonly conn: Client,
    deadlineMs: number,
  ) {
    const agent = new http.Agent({ keepAlive: false });
    const createConnection: NonNullable<
      Pick<http.Agent, 'createConnection'>['createConnection']
    > = (_options, callback) => {
      const done = callback ?? (() => undefined);
      if (this.cause) {
        done(this.deadError(), null as never);
        return undefined;
      }
      this.conn.exec(DOCKER_DIAL_COMMAND, (err, stream) => {
        if (err || !stream) {
          done(
            err ??
              new SshFailure('DOCKER_UNREACHABLE', 'no docker exec channel'),
            null as never,
          );
          return;
        }
        // Ошибку канала не переизлучаем: http уже получил сокет, а гарантированное
        // завершение даёт дедлайн. Без слушателя 'error' ронял бы процесс.
        stream.on('error', () => undefined);
        // stderr и код выхода — единственный источник диагноза «Docker
        // недоступен»: отдельный exec на проверку мы не делаем.
        stream.stderr.on('data', (chunk: Buffer) => {
          this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(
            -STDERR_TAIL_BYTES,
          );
        });
        stream.on('exit', (code: number | null) => {
          this.exitCode = code;
        });
        done(null, stream);
      });
      return undefined;
    };
    agent.createConnection = createConnection;
    this.agent = agent;
    this.timer = setTimeout(() => this.expire(), deadlineMs);
    this.timer.unref();
  }

  get dead(): boolean {
    return this.cause !== null;
  }

  get failure(): { stderr: string; code: number | null } {
    return { stderr: this.stderrTail, code: this.exitCode };
  }

  close(): void {
    this.cause = 'closed';
    this.teardown();
  }

  private expire(): void {
    this.cause = 'deadline';
    this.teardown();
  }

  private deadError(): SshFailure {
    return this.cause === 'deadline'
      ? new SshFailure('TIMEOUT', 'docker api deadline exceeded')
      : new SshFailure('DOCKER_UNREACHABLE', 'docker transport is closed');
  }

  private teardown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.agent.destroy();
    this.conn.end();
  }
}

/**
 * docker-modem принимает `agent` (modem.js:112 `this.agent = opts.agent`,
 * :182 `optionsf.agent = this.agent`), но @types/dockerode 4.0.2 этого поля не
 * описывает. Каст собран в одном месте, чтобы он не расползался по модулю.
 */
export function createDockerode(transport: DockerTransport): Dockerode {
  return new Dockerode({
    // host/port не используются: сокет всегда даёт agent (туннель поверх SSH).
    host: 'http://127.0.0.1:1',
    agent: transport.agent,
  } as unknown as ConstructorParameters<typeof Dockerode>[0]);
}

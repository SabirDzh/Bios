import {
  SshFailure,
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

  /**
   * Очистка между тестами: двойник создаётся один раз на прогон (DI-override в
   * beforeAll), иначе накопленные команды и ответы просачиваются в следующий тест.
   */
  reset(): void {
    this.commands.length = 0;
    this.sessions.length = 0;
    this.probes.length = 0;
    this.replies.length = 0;
  }

  /** Секрет не имеет права появляться в тексте удалённой команды. */
  assertNoSecretLeak(secret: string): void {
    if (this.commands.some((command) => command.includes(secret))) {
      throw new Error('remote command contains the credential');
    }
  }
}

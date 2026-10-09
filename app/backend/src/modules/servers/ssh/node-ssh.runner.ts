import { Inject, Injectable } from '@nestjs/common';
import { NodeSSH, type Config } from 'node-ssh';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';
import { classifySshError } from './classify-ssh-error';
import { hostKeyFingerprint } from './host-key';
import {
  SshFailure,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh-runner';

@Injectable()
export class NodeSshRunner implements SshRunner {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async exec(
    session: SshSession,
    command: string,
    timeoutMs: number,
  ): Promise<SshExecResult> {
    const ssh = new NodeSSH();
    let observed: string | null = null;
    let rejectedByPolicy = false;

    const config: Config = {
      host: session.address,
      port: session.port,
      username: session.username,
      readyTimeout: this.cfg.ssh.connectTimeoutMs,
      // tryKeyboard НЕ ставим: обработчика keyboard-interactive нет (ревью №10).
      hostVerifier: (key: Buffer | string): boolean => {
        observed = hostKeyFingerprint(
          Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex'),
        );
        const expected = session.expectedHostKeyFingerprint;
        if (expected === null || observed !== expected) {
          rejectedByPolicy = true; // креденшелы не отправятся: верификатор валит KEX
          return false;
        }
        return true;
      },
      ...(session.authType === 'PASSWORD'
        ? { password: session.secret }
        : { privateKey: session.secret }),
    };

    let guard: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      guard = setTimeout(
        () => reject(new SshFailure('TIMEOUT', 'ssh operation timed out')),
        timeoutMs,
      );
      guard.unref();
    });

    try {
      await Promise.race([ssh.connect(config), timeout]);
      const res = await Promise.race([ssh.execCommand(command), timeout]);
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    } catch (err) {
      // Верификатор вернул false → ssh2 рвёт соединение своей ошибкой, которая
      // выглядит как транспортный сбой. Сначала разбираемpolicy-отказ.
      if (rejectedByPolicy) throw this.policyFailure(session, observed);
      if (err instanceof SshFailure) throw err;
      throw new SshFailure(classifySshError(err), 'ssh transport failure');
    } finally {
      if (guard) clearTimeout(guard);
      ssh.dispose();
    }
  }

  private policyFailure(
    session: SshSession,
    observed: string | null,
  ): SshFailure {
    return session.expectedHostKeyFingerprint === null
      ? new SshFailure(
          'HOST_KEY_NOT_TRUSTED',
          'host key is not trusted yet',
          observed ?? undefined,
        )
      : new SshFailure(
          'HOST_KEY_MISMATCH',
          'host key does not match the pinned fingerprint',
          observed ?? undefined,
        );
  }
}

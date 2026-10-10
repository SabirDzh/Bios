import { Inject, Injectable } from '@nestjs/common';
import { NodeSSH, type Config } from 'node-ssh';
import { Client, type ConnectConfig } from 'ssh2';
import { APP_CONFIG, type AppConfig } from '../../../config/app.config';
import { createDockerode, DockerSshTransport } from './docker-agent';
import { classifySshError } from './classify-ssh-error';
import { hostKeyFingerprint } from './host-key';
import {
  SshFailure,
  type DockerTransport,
  type SshExecResult,
  type SshRunner,
  type SshSession,
} from './ssh-runner';

interface PolicyState {
  observed: string | null;
  rejectedByPolicy: boolean;
}

@Injectable()
export class NodeSshRunner implements SshRunner {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /**
   * Единая точка политики доверия хосту: верификатор вызывается на KEX, то есть
   * ДО user-auth — при expectedHostKeyFingerprint === null он возвращает false
   * всегда, и креденшелы на неподтверждённый хост физически не уходят. Правило
   * действует и для exec, и для Docker-транспорта, поэтому оно не дублируется.
   */
  private connectConfig(
    session: SshSession,
    state: PolicyState,
  ): ConnectConfig {
    return {
      host: session.address,
      port: session.port,
      username: session.username,
      readyTimeout: this.cfg.ssh.connectTimeoutMs,
      // tryKeyboard НЕ ставим: обработчика keyboard-interactive нет (ревью №10).
      hostVerifier: (key: Buffer | string): boolean => {
        state.observed = hostKeyFingerprint(
          Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex'),
        );
        if (
          session.expectedHostKeyFingerprint === null ||
          state.observed !== session.expectedHostKeyFingerprint
        ) {
          state.rejectedByPolicy = true;
          return false;
        }
        return true;
      },
      ...(session.authType === 'PASSWORD'
        ? { password: session.secret }
        : { privateKey: session.secret }),
    };
  }

  async exec(
    session: SshSession,
    command: string,
    timeoutMs: number,
  ): Promise<SshExecResult> {
    const ssh = new NodeSSH();
    const state: PolicyState = { observed: null, rejectedByPolicy: false };

    let guard: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      guard = setTimeout(
        () => reject(new SshFailure('TIMEOUT', 'ssh operation timed out')),
        timeoutMs,
      );
      guard.unref();
    });

    try {
      await Promise.race([
        ssh.connect(this.connectConfig(session, state) as Config),
        timeout,
      ]);
      const res = await Promise.race([ssh.execCommand(command), timeout]);
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    } catch (err) {
      if (state.rejectedByPolicy) {
        throw this.policyFailure(session, state.observed);
      }
      if (err instanceof SshFailure) throw err;
      throw new SshFailure(classifySshError(err), 'ssh transport failure');
    } finally {
      if (guard) clearTimeout(guard);
      ssh.dispose();
    }
  }

  async dockerTransport(
    session: SshSession,
    deadlineMs: number,
  ): Promise<DockerTransport> {
    const startedAt = Date.now();
    const remaining = () => Math.max(1, deadlineMs - (Date.now() - startedAt));
    const conn = new Client();
    const state: PolicyState = { observed: null, rejectedByPolicy: false };

    try {
      await this.waitForReady(conn, session, state, remaining());
      const transport = new DockerSshTransport(conn, remaining());
      if (transport.dead) {
        conn.end();
        throw new SshFailure('TIMEOUT', 'docker api deadline exceeded');
      }
      return transport;
    } catch (err) {
      conn.end();
      if (err instanceof SshFailure) throw err;
      throw new SshFailure(classifySshError(err), 'ssh transport failure');
    }
  }

  private waitForReady(
    conn: Client,
    session: SshSession,
    state: PolicyState,
    budgetMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SshFailure('TIMEOUT', 'docker transport timed out'));
      }, budgetMs);
      timer.unref();
      conn.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      conn.once('error', (err: Error) => {
        clearTimeout(timer);
        reject(
          state.rejectedByPolicy
            ? this.policyFailure(session, state.observed)
            : new SshFailure(classifySshError(err), 'ssh transport failure'),
        );
      });
      conn.connect(this.connectConfig(session, state));
    });
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

export { createDockerode };

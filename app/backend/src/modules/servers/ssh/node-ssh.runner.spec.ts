import { generateKeyPairSync } from 'node:crypto';
import net from 'node:net';
import { NodeSshRunner } from './node-ssh.runner';
import { SshFailure, type SshSession } from './ssh-runner';
import { startSshFixture } from './testing/ssh-server-fixture';
import type { AppConfig } from '../../../config/app.config';

// ssh2 не читает PKCS#8 («Unsupported key format»), поэтому приватный ключ
// генерируем в PKCS#1 — ровно тот формат, который пройдёт и в проде.
const PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

function runnerCfg(overrides: Partial<AppConfig['ssh']> = {}): AppConfig {
  return {
    ssh: {
      connectTimeoutMs: 1500,
      commandTimeoutMs: 1500,
      installTimeoutMs: 3000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22],
      allowLoopback: true,
      ...overrides,
    },
    crypto: {
      activeKey: { id: 'k1', key: Buffer.alloc(32, 7) },
      oldKeys: new Map(),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

function session(
  port: number,
  fingerprint: string | null,
  secret = 'sup3rsecret',
): SshSession {
  return {
    host: '127.0.0.1',
    address: '127.0.0.1',
    port,
    username: 'deploy',
    authType: 'PASSWORD',
    secret,
    expectedHostKeyFingerprint: fingerprint,
  };
}

const settle = async (ms = 250): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('NodeSshRunner (real ssh2 server)', () => {
  test('выполняет команду и возвращает stdout/stderr/code', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      exec: { stdout: '27.3.1\n', stderr: 'warn\n', code: 0 },
    });
    try {
      const res = await new NodeSshRunner(runnerCfg()).exec(
        session(fx.port, fx.fingerprint),
        "docker version --format '{{.Server.Version}}'",
        3000,
      );
      expect(res.stdout.trim()).toBe('27.3.1');
      expect(res.stderr.trim()).toBe('warn');
      expect(res.code).toBe(0);
      expect(fx.execRequests).toEqual([
        "docker version --format '{{.Server.Version}}'",
      ]);
    } finally {
      await fx.close();
    }
  });

  test('ненулевой код возврата доходит до вызывающего', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      exec: { stdout: '', stderr: 'no such file\n', code: 2 },
    });
    try {
      const res = await new NodeSshRunner(runnerCfg()).exec(
        session(fx.port, fx.fingerprint),
        'systemctl status bios-agent',
        3000,
      );
      expect(res.code).toBe(2);
      expect(res.stderr).toContain('no such file');
    } finally {
      await fx.close();
    }
  });

  test('probe НЕ отправляет креденшелы: аутентификация на сервере не началась', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret' });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(
        runner.exec(session(fx.port, null), 'echo hi', 3000),
      ).rejects.toMatchObject({
        code: 'HOST_KEY_NOT_TRUSTED',
        observedHostKeyFingerprint: fx.fingerprint,
      });
      expect(fx.authAttempts).toBe(0);
      expect(fx.execRequests).toEqual([]);
    } finally {
      await fx.close();
    }
  });

  test('несовпадение пина → HOST_KEY_MISMATCH, сервер не увидел пароля', async () => {
    const fx = await startSshFixture({ password: 'sup3rsecret' });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(
        runner.exec(
          session(fx.port, `SHA256:${'A'.repeat(43)}`),
          'echo hi',
          3000,
        ),
      ).rejects.toMatchObject({
        code: 'HOST_KEY_MISMATCH',
        observedHostKeyFingerprint: fx.fingerprint,
      });
      expect(fx.authAttempts).toBe(0);
    } finally {
      await fx.close();
    }
  });

  test('после принятия отпечатка подключение проходит', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      exec: { stdout: 'ok' },
    });
    try {
      const res = await new NodeSshRunner(runnerCfg()).exec(
        session(fx.port, fx.fingerprint),
        'echo ok',
        3000,
      );
      expect(res.stdout).toBe('ok');
      expect(fx.authAttempts).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('отказ аутентификации → AUTH_FAILED', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      behavior: 'reject-auth',
    });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(
        runner.exec(session(fx.port, fx.fingerprint), 'echo hi', 3000),
      ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    } finally {
      await fx.close();
    }
  });

  test('ключевая аутентификация: PEM принят, сервер его не принял → AUTH_FAILED', async () => {
    const fx = await startSshFixture({
      password: 'unused',
      behavior: 'reject-auth',
    });
    try {
      const runner = new NodeSshRunner(runnerCfg());
      await expect(
        runner.exec(
          { ...session(fx.port, fx.fingerprint, PEM), authType: 'KEY' },
          'echo hi',
          3000,
        ),
      ).rejects.toBeInstanceOf(SshFailure);
      // Дошли до аутентификации — значит ssh2 разобрал переданный PEM.
      expect(fx.authAttempts).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('зависшее рукопожатие → TIMEOUT по connectTimeoutMs и соединение закрыто', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      behavior: 'hang-auth',
    });
    try {
      const runner = new NodeSshRunner(runnerCfg({ connectTimeoutMs: 400 }));
      const started = Date.now();
      await expect(
        runner.exec(session(fx.port, fx.fingerprint), 'echo hi', 5000),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      // Запас по времени: смысл проверки — «не висит», а не точная миллисекунда.
      expect(Date.now() - started).toBeLessThan(3000);
      await settle();
      expect(fx.closedConnections).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('зависшая команда → TIMEOUT по таймауту операции, соединение освобождено', async () => {
    const fx = await startSshFixture({
      password: 'sup3rsecret',
      behavior: 'hang-exec',
    });
    try {
      const runner = new NodeSshRunner(runnerCfg({ commandTimeoutMs: 400 }));
      await expect(
        runner.exec(session(fx.port, fx.fingerprint), 'sleep 60', 400),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      await settle();
      expect(fx.closedConnections).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  test('порт закрыт → REFUSED, а не TIMEOUT', async () => {
    const port = await closedPort();
    const runner = new NodeSshRunner(runnerCfg());
    await expect(
      runner.exec(session(port, `SHA256:${'B'.repeat(43)}`), 'echo hi', 3000),
    ).rejects.toMatchObject({ code: 'REFUSED' });
  });
});

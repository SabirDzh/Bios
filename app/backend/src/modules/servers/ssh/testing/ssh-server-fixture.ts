import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Server, utils, type Connection, type ServerChannel } from 'ssh2';
import { hostKeyFingerprint } from '../host-key';

export interface FixtureOptions {
  /** Принимать ли password-аутентификацию с этим паролем. */
  password?: string;
  exec?: { stdout?: string; stderr?: string; code?: number };
  /**
   * 'reject-auth' — метод не принимаем никогда;
   * 'hang-auth' — на аутентификацию не отвечаем (срабатывает readyTimeout клиента);
   * 'hang-exec' — сессионный канал не открываем (команда висит).
   */
  behavior?: 'normal' | 'reject-auth' | 'hang-auth' | 'hang-exec';
}

export interface SshFixture {
  port: number;
  fingerprint: string;
  authAttempts: number;
  execRequests: string[];
  closedConnections: number;
  close(): Promise<void>;
}

/**
 * Настоящий SSH-сервер в том же процессе. Только он честно доказывает, что в
 * probe-режиме креденшелы не покидают процесс (`authAttempts === 0`), и что
 * зависшее соединение/команда прерываются по таймауту и соединение закрывается.
 */
export async function startSshFixture(
  options: FixtureOptions = {},
): Promise<SshFixture> {
  // ssh2 разбирает PKCS#1 (type 'pkcs8' для него «Unsupported key format»), а
  // отпечаток считаем с wire-блоба публичной части — как его увидит клиент.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  const publicBlob = parsed.getPublicSSH();
  if (!Buffer.isBuffer(publicBlob)) {
    throw new Error('fixture: cannot read public key blob');
  }

  const fixture: SshFixture = {
    port: 0,
    fingerprint: hostKeyFingerprint(publicBlob),
    authAttempts: 0,
    execRequests: [],
    closedConnections: 0,
    close: () => Promise.resolve(),
  };

  const behavior = options.behavior ?? 'normal';
  // ssh2-сервер не наследует net.Server (у него нет closeAllConnections), поэтому
  // активные соединения отслеживаем сами: иначе hang-тесты оставляют сокеты
  // открытыми, и jest-процесс не завершается.
  const live = new Set<Connection>();
  const server = new Server(
    { hostKeys: [Buffer.from(privateKey)] },
    (client: Connection) => {
      live.add(client);
      client.on('close', () => {
        live.delete(client);
        fixture.closedConnections += 1;
      });
      // Клиент, отвергший host key, рвёт KEX (DISCONNECT KEY_EXCHANGE_FAILED), и
      // ssh2 сервер отдаёт это как 'error' на соединении. Без слушателя Node считает
      // его необработанным и падает весь воркер; сам факт сбоя до аутентификации —
      // как раз то, что доказывает тест probe.
      client.on('error', () => undefined);
      client.on('authentication', (ctx) => {
        fixture.authAttempts += 1;
        if (behavior === 'hang-auth') return; // не отвечаем — readyTimeout на стороне клиента
        if (
          behavior === 'reject-auth' ||
          ctx.method !== 'password' ||
          ctx.password !== options.password
        ) {
          ctx.reject(['password']);
          return;
        }
        ctx.accept();
      });
      client.on('session', (accept) => {
        if (behavior === 'hang-exec') return; // канал не открываем: команда висит
        const session = accept();
        session.on('exec', (execAccept, _reject, info) => {
          const stream: ServerChannel = execAccept();
          fixture.execRequests.push(info.command);
          stream.stderr.write(options.exec?.stderr ?? '');
          stream.write(options.exec?.stdout ?? '');
          stream.exit(options.exec?.code ?? 0);
          stream.end();
        });
      });
    },
  );

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  fixture.port = (server.address() as AddressInfo).port;
  fixture.close = () =>
    new Promise<void>((resolve) => {
      // hang-режимы оставляют соединения активными: без end() сервер не закроется,
      // и jest-воркер зависнет на открытом handle.
      for (const client of live) client.end();
      server.close(() => resolve());
    });
  return fixture;
}

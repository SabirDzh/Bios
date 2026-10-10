import { generateKeyPairSync } from 'node:crypto';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Server, utils, type Connection, type ServerChannel } from 'ssh2';
import { hostKeyFingerprint } from '../host-key';

export interface FixtureOptions {
  /** Принимать ли password-аутентификацию с этим паролем. */
  password?: string;
  exec?: { stdout?: string; stderr?: string; code?: number };
  /**
   * Порт локального мока Docker API: exec-канал `docker system dial-stdio`
   * трубится в него в обе стороны, поэтому транспорт проверяется целиком —
   * ssh2, KEX, пин, канал и разбор ответа dockerode — без настоящего демона.
   */
  dialStdioPort?: number;
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
  /** Сколько раз клиент прошёл KEX и аутентифицировался (на соединение). */
  connections: number;
  /** SSH session channel: их несколько на одно соединение (по одному на exec). */
  sessions: number;
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
    connections: 0,
    sessions: 0,
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
      fixture.connections += 1;
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
        fixture.sessions += 1;
        if (behavior === 'hang-exec') return; // канал не открываем: команда висит
        const session = accept();
        session.on('exec', (execAccept, _reject, info) => {
          if (
            options.dialStdioPort &&
            info.command === 'docker system dial-stdio'
          ) {
            const channel: ServerChannel = execAccept();
            fixture.execRequests.push(info.command);
            const tcp = net.connect(options.dialStdioPort, '127.0.0.1');
            // Оба направления канала; закрытие любой стороны гасит другую.
            channel.pipe(tcp).pipe(channel);
            for (const side of [channel, tcp]) {
              side.on('error', () => {
                tcp.destroy();
                channel.close();
              });
              side.on('close', () => {
                tcp.destroy();
                channel.close();
              });
            }
            return;
          }
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

import { PassThrough } from 'node:stream';
import type { Client } from 'ssh2';
import { SshFailure } from './ssh-runner';
import { DOCKER_DIAL_COMMAND, DockerSshTransport } from './docker-agent';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Мок ssh2.Client: exec отдаёт наш PassThrough, end считает закрытия.
 * Настоящий SSH-транспорт проверяется отдельно — в node-ssh.docker-transport.spec.ts.
 */
function fakeClient(hang = false): {
  conn: Client;
  commands: string[];
  ends: number;
  execs: number;
} {
  const state = { commands: [] as string[], ends: 0, execs: 0 };
  const conn = {
    exec(
      command: string,
      cb: (err: Error | null, stream?: PassThrough) => void,
    ) {
      state.commands.push(command);
      state.execs += 1;
      if (hang) return;
      cb(null, new PassThrough());
    },
    end() {
      state.ends += 1;
    },
  } as unknown as Client;
  return Object.assign(state, { conn });
}

function connect(transport: DockerSshTransport): Promise<Error | null> {
  return new Promise((resolve) => {
    transport.agent.createConnection({}, (err: Error | null) =>
      resolve(err ?? null),
    );
  });
}

test('транспорт открывает exec-канал docker system dial-stdio', async () => {
  const client = fakeClient();
  const { commands } = client;
  const transport = new DockerSshTransport(client.conn, 5000);
  expect(await connect(transport)).toBeNull();
  expect(commands).toEqual([DOCKER_DIAL_COMMAND]);
  transport.close();
});

test('ошибка exec отдаётся вызывающему как ошибка соединения', async () => {
  const failing = {
    exec: (
      _command: string,
      cb: (err: Error | null, stream?: PassThrough) => void,
    ) => cb(new Error('exec failed')),
    end: () => undefined,
  } as unknown as Client;
  const transport = new DockerSshTransport(failing, 5000);
  const err = await connect(transport);
  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toBe('exec failed');
  transport.close();
});

test('close завершает ssh-коннект и делает новые каналы невозможными', async () => {
  const client = fakeClient();
  const transport = new DockerSshTransport(client.conn, 5000);
  await connect(transport);
  expect(client.execs).toBe(1);

  transport.close();

  expect(client.ends).toBe(1);
  expect(transport.dead).toBe(true);
  const err = await connect(transport);
  expect(err).toBeInstanceOf(SshFailure);
  expect(client.execs).toBe(1);
});

test('дедлайн закрывает транспорт сам, без явного close', async () => {
  const client = fakeClient(true);
  const transport = new DockerSshTransport(client.conn, 20);
  await sleep(60);

  expect(transport.dead).toBe(true);
  expect(client.ends).toBe(1);
  const err = await connect(transport);
  expect(err).toBeInstanceOf(SshFailure);
  expect((err as SshFailure).code).toBe('TIMEOUT');
  expect(client.execs).toBe(0);
});

test('открытый канал не удерживает таймер: процесс может выйти сам', async () => {
  const client = fakeClient();
  const transport = new DockerSshTransport(client.conn, 60_000);
  await connect(transport);
  // unref() на таймере дедлайна — иначе jest-воркер висел бы 60 секунд.
  expect(transport.dead).toBe(false);
  transport.close();
});

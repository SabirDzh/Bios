import http from 'node:http';
import { createDockerode } from './docker-agent';
import { NodeSshRunner } from './node-ssh.runner';
import { SshFailure, type SshSession } from './ssh-runner';
import { startSshFixture, type SshFixture } from './testing/ssh-server-fixture';
import { testAppConfig } from '../../../config/testing/app-config.fixture';

/**
 * Мок Docker API на настоящем http.Server: SSH-фикстура трубится в него
 * exec-каналом `docker system dial-stdio`. Так тест проверяет весь путь —
 * ssh2, KEX, пин, exec-канал и разбор ответа dockerode — без демона.
 */
function dockerMock(): {
  ready: Promise<number>;
  hits: string[];
  setHang(hang: boolean): void;
  close(): Promise<void>;
} {
  const hits: string[] = [];
  let hang = false;
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    hits.push(path);
    if (hang) return; // демон молчит: ответ не отправляем вовсе
    res.setHeader('content-type', 'application/json');
    if (path.startsWith('/version')) {
      res.end(JSON.stringify({ ApiVersion: '1.51', Version: 'mock-28.3.2' }));
      return;
    }
    if (path.startsWith('/containers/json')) {
      res.end(
        JSON.stringify([
          {
            Id: 'aaaa',
            Names: ['/web'],
            Image: 'nginx:1.27',
            State: 'running',
            Status: 'Up 2 hours',
            Created: 1700000000,
            Ports: [],
            Labels: {},
          },
        ]),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'not found' }));
  });
  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
  return {
    ready,
    hits,
    setHang: (value: boolean) => {
      hang = value;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function session(port: number, pin: string | null): SshSession {
  return {
    host: '127.0.0.1',
    address: '127.0.0.1',
    port,
    username: 'root',
    authType: 'PASSWORD',
    secret: 'sup3rsecret',
    expectedHostKeyFingerprint: pin,
  };
}

let mock: ReturnType<typeof dockerMock>;
let mockPort: number;
let fx: SshFixture;
let runner: NodeSshRunner;

beforeEach(async () => {
  mock = dockerMock();
  mockPort = await mock.ready;
  fx = await startSshFixture({
    password: 'sup3rsecret',
    dialStdioPort: mockPort,
  });
  runner = new NodeSshRunner(testAppConfig());
});

// Очистка вне try: если dockerTransport падает, сокет фикстуры иначе останется
// висеть, и jest не сможет выйти (проверено — прогон зависал на минутах).
afterEach(async () => {
  await fx.close();
  await mock.close();
});

test('один ssh-коннект обслуживает несколько вызовов dockerode', async () => {
  const transport = await runner.dockerTransport(
    session(fx.port, fx.fingerprint),
    8000,
  );
  try {
    const docker = createDockerode(transport);
    expect(await docker.version()).toMatchObject({ Version: 'mock-28.3.2' });
    const list = await docker.listContainers();
    expect(list[0]?.Id).toBe('aaaa');
    expect(await docker.listContainers()).toHaveLength(1);
  } finally {
    transport.close();
  }

  expect(mock.hits).toEqual([
    '/version',
    '/containers/json',
    '/containers/json',
  ]);
  // Три вызова API = одно SSH-соединение и три exec-канала: переиспользование
  // проверяется именно по connections (sessions в ssh2 — это каналы, не коннекты).
  expect(fx.connections).toBe(1);
  // Два события аутентификации на ОДНОМ соединении — штатное поведение ssh2:
  // проба метода 'none', затем 'password'. Именно connections доказывает, что
  // рукопожатие было одним.
  expect(fx.authAttempts).toBe(2);
  expect(fx.sessions).toBe(3);
  expect(fx.execRequests).toEqual([
    'docker system dial-stdio',
    'docker system dial-stdio',
    'docker system dial-stdio',
  ]);
});

test('без принятого пина транспорт падает до аутентификации', async () => {
  await expect(
    runner.dockerTransport(session(fx.port, null), 8000),
  ).rejects.toBeInstanceOf(SshFailure);
  await expect(
    runner.dockerTransport(session(fx.port, null), 8000),
  ).rejects.toMatchObject({ code: 'HOST_KEY_NOT_TRUSTED' });
  // Пароль не отправлялся ни разу: верификатор валит KEX до user-auth.
  expect(fx.authAttempts).toBe(0);
  expect(mock.hits).toHaveLength(0);
});

test('пин не совпал → HOST_KEY_MISMATCH', async () => {
  await expect(
    runner.dockerTransport(session(fx.port, `SHA256:${'Z'.repeat(43)}`), 8000),
  ).rejects.toMatchObject({ code: 'HOST_KEY_MISMATCH' });
  expect(fx.authAttempts).toBe(0);
});

test('зависший демон прерывается дедлайном транспорта', async () => {
  mock.setHang(true);
  const transport = await runner.dockerTransport(
    session(fx.port, fx.fingerprint),
    120,
  );
  const docker = createDockerode(transport);
  // В jest-песочнице instanceof Error может не совпасть с Error из vm-контекста,
  // поэтому проверяем факт отказа и его код, а не класс.
  const failure = await docker.version().then(
    () => null,
    (err: unknown) => err as Error,
  );
  expect(failure).not.toBeNull();
  expect(transport.dead).toBe(true);
  // После дедлайна транспорт обязан отказывать новым каналам с TIMEOUT.
  const second = await new Promise<unknown>((resolve) => {
    transport.agent.createConnection({}, (err) => resolve(err));
  });
  expect(second).toMatchObject({ code: 'TIMEOUT' });
  transport.close();
});

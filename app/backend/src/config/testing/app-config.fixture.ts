import type { AppConfig } from '../app.config';

/**
 * Конфиг для серверных спеков: короткие таймауты, loopback разрешён, ключей
 * достаточно, чтобы проверить перевёртку. Отдельный модуль, а не экспорт из
 * *.spec — импорт из спека выполнил бы весь его `describe` вторым экземпляром
 * в параллельном jest-воркере, и две копии начали бы драться за одни строки БД.
 */
export function testAppConfig(
  overrides: Partial<AppConfig['ssh']> = {},
  dockerOverrides: Partial<AppConfig['docker']> = {},
  deployOverrides: Partial<AppConfig['deploy']> = {},
): AppConfig {
  return {
    ssh: {
      connectTimeoutMs: 1500,
      commandTimeoutMs: 1500,
      installTimeoutMs: 3000,
      agentVersion: '0.1.0',
      heartbeatStaleSec: 60,
      allowedPorts: [22, 2202],
      allowLoopback: true,
      ...overrides,
    },
    docker: {
      logsMaxBytes: 262144,
      // Намеренно не равен ssh.commandTimeoutMs: тест видит, какой дедлайн
      // сервис передал под конкретную операцию.
      statsTimeoutMs: 900,
      ...dockerOverrides,
    },
    deploy: {
      rootDir: '/tmp/bios-deploy',
      // Заметно меньше ssh.commandTimeoutMs: тест видит, какой дедлайн
      // исполнитель повесил на шаг, а не на всю операцию.
      stepTimeoutMs: 2000,
      logTailBytes: 512,
      hostLogBytes: 65536,
      // Один слот: последовательность «claim → шаги → finalize» наблюдаема
      // в тестах без гонок, а реальные 2 слота проверяются отдельным тестом.
      maxParallel: 1,
      ...deployOverrides,
    },
    meili: {
      host: 'http://127.0.0.1:7700',
      masterKey: null,
      timeoutMs: 3000,
    },
    crypto: {
      activeKey: { id: 'k1', key: Buffer.alloc(32, 7) },
      oldKeys: new Map([['k0', Buffer.alloc(32, 6)]]),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

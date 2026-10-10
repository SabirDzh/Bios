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
    crypto: {
      activeKey: { id: 'k1', key: Buffer.alloc(32, 7) },
      oldKeys: new Map([['k0', Buffer.alloc(32, 6)]]),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

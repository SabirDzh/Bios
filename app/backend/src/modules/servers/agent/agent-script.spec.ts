import { priv, shq } from './shell-quote';
import {
  AGENT_UNIT,
  PROD_AGENT_PATHS,
  agentStatusOf,
  buildAgentReadCommand,
  buildDockerVersionCommand,
  buildInstallScript,
  parseAgentState,
  type AgentRawState,
} from './agent-script';

const WS = '01912345-6789-7abc-aef0-1234567890ab';
const SRV = '01912345-6789-7abc-aef0-1234567890ac';
const expected = { workspaceId: WS, serverId: SRV };
const manifest = `{"version":"0.1.0","workspaceId":"${WS}","serverId":"${SRV}"}`;

type Key = 'SD' | 'MF' | 'JSON' | 'UNIT' | 'HB' | 'NOW';
const KEYS: Key[] = ['SD', 'MF', 'JSON', 'UNIT', 'HB', 'NOW'];

const out = (fields: Partial<Record<Key, string>>): string =>
  KEYS.map((k) => `${k}=${fields[k] ?? '-'}`).join('\n');

describe('shell quoting', () => {
  test('shq экранирует одинарную кавычку POSIX-идиомой', () => {
    expect(shq('plain')).toBe("'plain'");
    expect(shq("it's")).toBe("'it'\\''s'");
    expect(shq('a; rm -rf /')).toBe("'a; rm -rf /'");
    expect(shq('$(id)`id`')).toBe("'$(id)`id`'");
  });

  test('priv оборачивает только непривилегированного пользователя', () => {
    expect(priv('echo hi', true)).toBe('echo hi');
    expect(priv('echo hi', false)).toBe("sudo -n sh -lc 'echo hi'");
  });
});

describe('install script', () => {
  const script = buildInstallScript({
    workspaceId: WS,
    serverId: SRV,
    version: '0.1.0',
    root: true,
  });

  test('префлайт различает docker-нет-CLI, отказ доступа и молчащий сокет', () => {
    expect(script).toContain('BIOS_ERR_DOCKER >&2; exit 42');
    expect(script).toContain('BIOS_ERR_DOCKER_PERM >&2; exit 45');
    expect(script).toContain('BIOS_ERR_DOCKER_SOCKET >&2; exit 46');
    expect(script).toContain('BIOS_ERR_SYSTEMD >&2; exit 43');
  });

  test('манифест с идентификаторами, юнит с автоперезапуском', () => {
    expect(script).toContain(`${PROD_AGENT_PATHS.dir}/agent.json`);
    expect(script).toContain(`"serverId":"${SRV}"`);
    expect(script).toContain(`systemctl enable ${AGENT_UNIT}`);
    expect(script).toContain('Restart=always');
  });

  test('root — без sudo, непривилегированный — каждый опасный шаг в sudo -n', () => {
    const sudo = buildInstallScript({
      workspaceId: WS,
      serverId: SRV,
      version: '0.1.0',
      root: false,
    });
    expect(script).not.toContain('sudo -n');
    expect(sudo).toContain('sudo -n');
  });

  test('payload с кавычкой и command substitution попадает в команду экранированным', () => {
    const evil = buildInstallScript({
      workspaceId: WS,
      serverId: "x'$(touch /tmp/pwned)",
      version: '0.1.0',
      root: true,
    });
    // Точная escaped-последовательность: shq разрывает подстроку вставкой '\''
    // (ревью №9), поэтому проверять надо именно её, а не исходный текст.
    expect(evil).toContain(`"serverId":"x'\\''$(touch /tmp/pwned)"`);
    expect(evil).not.toContain(`"serverId":"x'$(touch /tmp/pwned)"`);
  });
});

describe('read command and parser', () => {
  test('команда чтения печатает все шесть ключей', () => {
    const cmd = buildAgentReadCommand();
    for (const key of KEYS) {
      expect(cmd).toContain(`printf '${key}=%s\\n'`);
    }
    expect(cmd).toContain(`systemctl is-active ${AGENT_UNIT}`);
  });

  test('пути в команде чтения экранированы', () => {
    const cmd = buildAgentReadCommand({
      ...PROD_AGENT_PATHS,
      manifestPath: "/tmp/it's/agent.json",
      heartbeatPath: '/tmp/heartbeat',
    });
    expect(cmd).toContain(`'/tmp/it'\\''s/agent.json'`);
  });

  test('docker version command — ровно одна команда', () => {
    expect(buildDockerVersionCommand()).toBe(
      "docker version --format '{{.Server.Version}}'",
    );
  });

  test('полный протокол разбирается по полям', () => {
    expect(
      parseAgentState(
        out({
          SD: 'ok',
          MF: 'present',
          JSON: manifest,
          UNIT: 'active',
          HB: '1000',
          NOW: '1030',
        }),
      ),
    ).toEqual({
      protocolOk: true,
      systemd: 'ok',
      manifestFile: 'present',
      manifest: { version: '0.1.0', workspaceId: WS, serverId: SRV },
      manifestParseError: false,
      unit: 'active',
      heartbeatSec: 1000,
      nowSec: 1030,
    } satisfies AgentRawState);
  });

  test('битый JSON и мусор вместо протокола различимы', () => {
    const broken = parseAgentState(
      out({
        SD: 'ok',
        MF: 'present',
        JSON: '{not json',
        UNIT: 'active',
        HB: '1',
        NOW: '2',
      }),
    );
    expect(broken.manifest).toBeNull();
    expect(broken.manifestParseError).toBe(true);

    const garbage = parseAgentState('nothing useful here');
    expect(garbage.protocolOk).toBe(false);
    expect(garbage.systemd).toBe('unreadable');
  });

  test('машина состояний соответствует таблице плана', () => {
    const stale = 60;
    const run = (fields: Parameters<typeof out>[0]) =>
      agentStatusOf(parseAgentState(out(fields)), stale, expected);

    expect(run({ SD: 'ok', MF: 'absent', UNIT: 'no-unit', NOW: '10' })).toEqual(
      { status: 'NOT_INSTALLED', errorCode: null },
    );
    expect(
      run({ SD: 'missing', MF: 'absent', UNIT: 'no-unit', NOW: '10' }),
    ).toEqual({ status: 'NOT_INSTALLED', errorCode: null });
    expect(run({ SD: 'ok', MF: 'absent', UNIT: 'active', NOW: '10' })).toEqual({
      status: 'FAILED',
      errorCode: 'AGENT_MANIFEST_MISSING',
    });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: manifest,
        UNIT: 'active',
        HB: '1000',
        NOW: '1061',
      }),
    ).toEqual({ status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: manifest,
        UNIT: 'active',
        NOW: '1061',
      }),
    ).toEqual({ status: 'STALE', errorCode: 'AGENT_HEARTBEAT_STALE' });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: manifest,
        UNIT: 'failed',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'FAILED', errorCode: 'AGENT_NOT_RUNNING' });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: '{bad',
        UNIT: 'active',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'FAILED', errorCode: 'MANIFEST_INVALID' });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: `{"version":"0.1.0","workspaceId":"${WS}","serverId":"other"}`,
        UNIT: 'active',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'FAILED', errorCode: 'IDENTITY_MISMATCH' });
    expect(
      run({
        SD: 'missing',
        MF: 'present',
        JSON: manifest,
        UNIT: 'no-unit',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'FAILED', errorCode: 'SYSTEMD_MISSING' });
    expect(
      run({
        SD: 'ok',
        MF: 'present',
        JSON: manifest,
        UNIT: 'active',
        HB: '1000',
        NOW: '1030',
      }),
    ).toEqual({ status: 'ACTIVE', errorCode: null });
    expect(agentStatusOf(parseAgentState('garbage'), stale, expected)).toEqual({
      status: 'FAILED',
      errorCode: 'READ_FAILED',
    });
  });
});

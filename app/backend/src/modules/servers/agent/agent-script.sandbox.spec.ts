import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgentReadCommand,
  buildInstallScript,
  parseAgentState,
  type AgentManifest,
  type AgentPaths,
} from './agent-script';

const WS = '01912345-6789-7abc-aef0-1234567890ab';
const SRV = "x'$(touch /tmp/bios-sandbox-pwned)";
const PWNED = '/tmp/bios-sandbox-pwned';

function stub(bin: string, name: string, body = 'exit 0\n'): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}`, { mode: 0o755 });
}

function sandboxPaths(root: string): AgentPaths {
  return {
    dir: join(root, 'opt'),
    unitPath: join(root, 'etc', 'bios-agent.service'),
    manifestPath: join(root, 'opt', 'agent.json'),
    heartbeatPath: join(root, 'opt', 'heartbeat'),
    scriptPath: join(root, 'opt', 'agent.sh'),
  };
}

function runScript(script: string, path: string): void {
  execFileSync('/bin/sh', ['-c', script], {
    env: { ...process.env, PATH: path },
    stdio: 'pipe',
  });
}

describe('install script in a real shell', () => {
  beforeEach(() => {
    rmSync(PWNED, { force: true });
  });

  afterAll(() => {
    rmSync(PWNED, { force: true });
  });

  test('payload с кавычкой и substitution ложится в файл литералом и не исполняется', () => {
    const root = mkdtempSync(join(tmpdir(), 'bios-agent-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    stub(bin, 'docker');
    stub(bin, 'systemctl');

    const paths = sandboxPaths(root);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(join(root, 'etc'), { recursive: true });

    const script = buildInstallScript({
      workspaceId: WS,
      serverId: SRV,
      version: '0.1.0',
      root: true,
      paths,
    });

    expect(() => runScript(script, `${bin}:${process.env.PATH}`)).not.toThrow();

    const written = JSON.parse(
      readFileSync(paths.manifestPath, 'utf8'),
    ) as AgentManifest;
    expect(written.serverId).toBe(SRV); // ровно тот же мусорный payload, ставший данными
    expect(written.workspaceId).toBe(WS);
    expect(written.version).toBe('0.1.0');
    expect(existsSync(PWNED)).toBe(false);
    expect(readFileSync(paths.scriptPath, 'utf8')).toContain('while :');
    expect(readFileSync(paths.unitPath, 'utf8')).toContain('Restart=always');

    // Чтение состояния с того же «хоста»: payload должен вернутся как данные.
    const stdout = execFileSync(
      '/bin/sh',
      ['-c', buildAgentReadCommand(paths)],
      {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: 'utf8',
      },
    );
    expect(parseAgentState(stdout).manifest?.serverId).toBe(SRV);
    expect(existsSync(PWNED)).toBe(false);
  });

  test('префлайт падает с 43, когда systemctl нет, и с 45 при отказе доступа к сокету', () => {
    const root = mkdtempSync(join(tmpdir(), 'bios-agent-preflight-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    mkdirSync(join(root, 'opt'), { recursive: true });
    const paths = sandboxPaths(root);

    stub(bin, 'docker');
    const script = buildInstallScript({
      workspaceId: WS,
      serverId: 'srv',
      version: '0.1.0',
      root: true,
      paths,
    });

    const systemdMissing = attempt(script, bin);
    expect(systemdMissing.code).toBe(43);
    expect(systemdMissing.stderr).toContain('BIOS_ERR_SYSTEMD');

    stub(bin, 'systemctl');
    stub(
      bin,
      'docker',
      'if [ "$1" = "info" ]; then echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1; fi\nexit 0\n',
    );
    const denied = attempt(script, bin);
    expect(denied.code).toBe(45);
    expect(denied.stderr).toContain('BIOS_ERR_DOCKER_PERM');

    stub(
      bin,
      'docker',
      'if [ "$1" = "info" ]; then echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1; fi\nexit 0\n',
    );
    const silent = attempt(script, bin);
    expect(silent.code).toBe(46);
    expect(silent.stderr).toContain('BIOS_ERR_DOCKER_SOCKET');
  });
});

/** Узкий PATH: только песочничные стабы и coreutils, чтобы отсутствие systemctl не подменялось системой. */
function attempt(
  script: string,
  bin: string,
): { code: number | undefined; stderr: string } {
  try {
    runScript(script, `${bin}:/usr/bin:/bin`);
    return { code: undefined, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer };
    return { code: e.status, stderr: String(e.stderr ?? '') };
  }
}

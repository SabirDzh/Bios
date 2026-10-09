import { SshFailure } from './ssh-runner';
import {
  ipCategory,
  parseHostLiteral,
  resolveTarget,
  type NetworkPolicy,
  type Resolver,
} from './network-policy';

const policy: NetworkPolicy = {
  allowedPorts: [22, 2202],
  allowLoopback: false,
};
const policyWithLoopback: NetworkPolicy = {
  allowedPorts: [22, 2202],
  allowLoopback: true,
};

const resolves =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(addresses);
const rejects: Resolver = () => Promise.reject(new Error('EAI_AGAIN'));

const fail = async (
  host: string,
  port = 22,
  p = policy,
  resolver: Resolver = resolves(),
): Promise<string> => {
  try {
    await resolveTarget(host, port, p, resolver);
    return 'no-error';
  } catch (err) {
    return err instanceof SshFailure ? err.code : `wrong-error:${String(err)}`;
  }
};

describe('ipCategory', () => {
  test('IPv4 разбирается по диапазонам', () => {
    expect(ipCategory('203.0.113.10')).toBe('public');
    expect(ipCategory('10.0.0.5')).toBe('private');
    expect(ipCategory('172.16.0.1')).toBe('private');
    expect(ipCategory('192.168.1.1')).toBe('private');
    expect(ipCategory('100.64.0.1')).toBe('private');
    expect(ipCategory('127.0.0.1')).toBe('loopback');
    expect(ipCategory('169.254.169.254')).toBe('linkLocal');
    expect(ipCategory('0.0.0.0')).toBe('unspecified');
    expect(ipCategory('224.0.0.5')).toBe('multicast');
    expect(ipCategory('240.0.0.1')).toBe('other');
    expect(ipCategory('not-an-ip')).toBe('invalid');
  });

  test('IPv6: loopback, link-local, unique-local, multicast, IPv4-mapped', () => {
    expect(ipCategory('::1')).toBe('loopback');
    expect(ipCategory('::')).toBe('unspecified');
    expect(ipCategory('fe80::1')).toBe('linkLocal');
    expect(ipCategory('fd12::34')).toBe('private');
    expect(ipCategory('ff02::1')).toBe('multicast');
    expect(ipCategory('2001:db8::1')).toBe('documentation');
    expect(ipCategory('::ffff:169.254.169.254')).toBe('linkLocal');
    expect(ipCategory('::ffff:203.0.113.10')).toBe('public');
  });

  test('IPv6 не путает глобальный unicast с учебным диапазоном', () => {
    expect(ipCategory('2001:4860:4860::8888')).toBe('public');
    expect(ipCategory('2400:cb00:2048:1::6814:1e49')).toBe('public');
    expect(ipCategory('2002:0a00:0005::1')).toBe('public');
  });

  test('hex-форма IPv4-отображенного адреса не обходит категорию', () => {
    expect(ipCategory('::ffff:a9fe:a9fe')).toBe('linkLocal');
    expect(ipCategory('::ffff:7f00:0001')).toBe('loopback');
    expect(ipCategory('::a9fe:a9fe')).toBe('linkLocal');
  });

  test('мусор и невозможные адреса — invalid', () => {
    for (const bad of [
      ':::',
      'gg00::1',
      '1.2.3.4.5',
      '300.1.1.1',
      '',
      '2001:db8:::1',
    ]) {
      expect(ipCategory(bad)).toBe('invalid');
    }
  });
});

describe('parseHostLiteral', () => {
  test('голый IPv4 и IPv6 в скобках распознаются, имена — нет', () => {
    expect(parseHostLiteral('203.0.113.10')).toBe('203.0.113.10');
    expect(parseHostLiteral('[fe80::1]')).toBe('fe80::1');
    expect(parseHostLiteral('srv.example.com')).toBeNull();
    expect(parseHostLiteral('203.0.113.999')).toBeNull();
    expect(parseHostLiteral('gg00::1')).toBeNull();
  });
});

describe('resolveTarget', () => {
  test('метаданные облака и link-local блокируются до соединения', async () => {
    expect(await fail('169.254.169.254')).toBe('TARGET_BLOCKED');
    expect(await fail('fe80::1')).toBe('TARGET_BLOCKED');
    expect(await fail('[::ffff:a9fe:a9fe]')).toBe('TARGET_BLOCKED');
    expect(await fail('0.0.0.0')).toBe('TARGET_BLOCKED');
    expect(await fail('224.0.0.5')).toBe('TARGET_BLOCKED');
    expect(await fail('240.0.0.1')).toBe('TARGET_BLOCKED');
  });

  test('приватные и публичные адреса разрешены', async () => {
    const resolver = resolves();
    await expect(
      resolveTarget('10.0.0.5', 22, policy, resolver),
    ).resolves.toEqual({ address: '10.0.0.5' });
    await expect(
      resolveTarget('203.0.113.10', 22, policy, resolver),
    ).resolves.toEqual({ address: '203.0.113.10' });
    await expect(
      resolveTarget('192.168.1.20', 2202, policy, resolver),
    ).resolves.toEqual({ address: '192.168.1.20' });
  });

  test('loopback зависит от флага', async () => {
    expect(await fail('127.0.0.1')).toBe('TARGET_BLOCKED');
    await expect(
      resolveTarget('127.0.0.1', 22, policyWithLoopback, resolves()),
    ).resolves.toEqual({ address: '127.0.0.1' });
  });

  test('порт вне allowlist блокируется раньше, чем адрес', async () => {
    expect(await fail('203.0.113.10', 23)).toBe('PORT_NOT_ALLOWED');
    expect(await fail('169.254.169.254', 23)).toBe('PORT_NOT_ALLOWED');
  });

  test('имя хоста резолвится, проверяется каждый адрес, соединяемся по проверенному IP', async () => {
    const calls: string[] = [];
    const resolver: Resolver = (host: string) => {
      calls.push(host);
      return Promise.resolve(['169.254.169.254', '203.0.113.77']);
    };
    await expect(
      resolveTarget('ok.example.com', 22, policy, resolver),
    ).resolves.toEqual({ address: '203.0.113.77' });
    expect(calls).toEqual(['ok.example.com']);
  });

  test('IPv6-ответ DNS тоже проходит проверку и получает приоритет IPv4', async () => {
    await expect(
      resolveTarget(
        'v6.example.com',
        22,
        policy,
        resolves('2001:db8::1', '10.0.0.9'),
      ),
    ).resolves.toEqual({ address: '10.0.0.9' });
    expect(
      await fail('v6.example.com', 22, policy, resolves('2001:db8::1')),
    ).toBe('TARGET_BLOCKED');
  });

  test('если все разрешённые адреса отсутствуют — TARGET_BLOCKED, если ни одного — RESOLUTION_FAILED', async () => {
    expect(
      await fail(
        'only-metadata.example.com',
        22,
        policy,
        resolves('169.254.169.254'),
      ),
    ).toBe('TARGET_BLOCKED');
    expect(await fail('nx.example.com', 22, policy, resolves())).toBe(
      'RESOLUTION_FAILED',
    );
    expect(await fail('nx.example.com', 22, policy, rejects)).toBe(
      'RESOLUTION_FAILED',
    );
  });

  test('сообщение не раскрывает внутренний адрес больше, чем нужно', async () => {
    await resolveTarget('169.254.169.254', 22, policy, resolves()).catch(
      (err: SshFailure) => {
        expect(err).toBeInstanceOf(SshFailure);
        expect(err.code).toBe('TARGET_BLOCKED');
        expect(err.message).toBe('target address is not allowed');
        expect(err.message).not.toContain('169.254');
      },
    );
  });
});

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateServerDto } from './create-server.dto';
import { SearchServersDto } from './search-servers.dto';
import { ServerIdsDto } from './server-ids.dto';
import { TestServerDto } from './test-server.dto';

const V7 = '01912345-6789-7abc-aef0-1234567890ab';
const V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n';
const base = {
  name: 'prod-1',
  host: '203.0.113.10',
  port: 22,
  sshUsername: 'deploy',
};

async function errorsOf(
  cls: new () => object,
  input: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input));
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const withPassword = (extra: object = {}) => ({
  ...base,
  authType: 'PASSWORD',
  sshPassword: 'secret1234',
  ...extra,
});

const XOR_MSG_PASSWORD =
  'sshPassword is required and sshPrivateKey must be omitted for authType PASSWORD';
const MISSING_PASSWORD = 'sshPassword is required for authType PASSWORD';
const XOR_MSG_KEY =
  'sshPrivateKey is required and sshPassword must be omitted for authType KEY';
const MISSING_KEY = 'sshPrivateKey is required for authType KEY';

describe('server DTOs: credential shape', () => {
  test('только пароль под authType PASSWORD — валидно', async () => {
    expect(await errorsOf(CreateServerDto, withPassword())).toEqual([]);
  });

  test('только ключ под authType KEY — валидно', async () => {
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPrivateKey: PEM,
      }),
    ).toEqual([]);
  });

  test('ни одного креденшела — 400', async () => {
    expect(
      await errorsOf(CreateServerDto, { ...base, authType: 'PASSWORD' }),
    ).toContain(MISSING_PASSWORD);
    expect(
      await errorsOf(CreateServerDto, { ...base, authType: 'KEY' }),
    ).toContain(MISSING_KEY);
  });

  test('оба креденшела — 400 с явным указанием, что убрать', async () => {
    expect(
      await errorsOf(CreateServerDto, withPassword({ sshPrivateKey: PEM })),
    ).toContain(XOR_MSG_PASSWORD);
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPassword: 'secret1234',
        sshPrivateKey: PEM,
      }),
    ).toContain(XOR_MSG_KEY);
  });

  test('креденшел не по declared authType — 400', async () => {
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'PASSWORD',
        sshPrivateKey: PEM,
      }),
    ).toContain(XOR_MSG_PASSWORD);
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPassword: 'secret1234',
      }),
    ).toContain(XOR_MSG_KEY);
  });

  test('authType вне enum — 400, и сообщение не врёт про несуществующий тип', async () => {
    const messages = await errorsOf(CreateServerDto, {
      ...base,
      authType: 'AGENT',
      sshPassword: 'secret1234',
    });
    expect(messages).toContain(
      'authType must be one of the following values: PASSWORD, KEY',
    );
    expect(
      messages.filter((m) => m.includes('is required for authType')),
    ).toEqual([]);
  });

  test('format и длина проверяются только у declared креденшела', async () => {
    expect(
      await errorsOf(CreateServerDto, withPassword({ sshPassword: 'short' })),
    ).toContain('sshPassword must be longer than or equal to 8 characters');
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPrivateKey: 'not a key at all here',
      }),
    ).toContain('sshPrivateKey must be a PEM private key');
    expect(
      await errorsOf(CreateServerDto, {
        ...base,
        authType: 'KEY',
        sshPrivateKey: PEM.replace('BEGIN OPENSSH', 'BEGIN PUBLIC'),
      }),
    ).toContain('sshPrivateKey must be a PEM private key');
  });

  test('ENCRYPTED-PEM проходит фильтр формы: структуру ключа проверяет сервис', async () => {
    const errors = await errorsOf(CreateServerDto, {
      ...base,
      authType: 'KEY',
      sshPrivateKey: PEM.replace('BEGIN OPENSSH', 'BEGIN ENCRYPTED'),
    });
    expect(errors).toEqual([]);
  });
});

describe('server DTOs: other fields', () => {
  test('host: только hostname/IPv4, без shell-метасимволов и IPv6', async () => {
    for (const bad of [
      'a; rm -rf /',
      'host `id`',
      '$(id)',
      'ho st',
      'fe80::1',
      '-leading',
      '',
      'h'.repeat(254),
    ]) {
      expect(
        await errorsOf(CreateServerDto, withPassword({ host: bad })),
      ).not.toEqual([]);
    }
    for (const good of ['203.0.113.10', 'srv-1.example.com', 'a', 'ab']) {
      expect(
        await errorsOf(CreateServerDto, withPassword({ host: good })),
      ).toEqual([]);
    }
  });

  test('sshUsername — POSIX-имя', async () => {
    for (const bad of ['root x', '1user', "o'brien", 'A'.repeat(40)]) {
      expect(
        await errorsOf(CreateServerDto, withPassword({ sshUsername: bad })),
      ).not.toEqual([]);
    }
    expect(
      await errorsOf(
        CreateServerDto,
        withPassword({ sshUsername: '_deploy-9' }),
      ),
    ).toEqual([]);
  });

  test('name тримится, port в диапазоне, дефолт 22', async () => {
    expect(
      await errorsOf(CreateServerDto, withPassword({ name: '   ' })),
    ).not.toEqual([]);
    expect(
      plainToInstance(CreateServerDto, withPassword({ name: '  prod-1  ' }))
        .name,
    ).toBe('prod-1');
    expect(
      await errorsOf(CreateServerDto, withPassword({ port: 70000 })),
    ).not.toEqual([]);
    expect(
      await errorsOf(CreateServerDto, withPassword({ port: '2222' })),
    ).toEqual([]);
    expect(new CreateServerDto().port).toBe(22);
  });

  test('host приводится к нижнему регистру, username — тоже', () => {
    const dto = plainToInstance(
      CreateServerDto,
      withPassword({ host: 'SRV-1.Example.COM', sshUsername: 'Deploy' }),
    );
    expect(dto.host).toBe('srv-1.example.com');
    expect(dto.sshUsername).toBe('deploy');
  });

  test('ServerIdsDto — оба uuid v7; TestServerDto — fingerprint формата SHA256:<base64>', async () => {
    expect(
      await errorsOf(ServerIdsDto, { workspaceId: V7, serverId: V7 }),
    ).toEqual([]);
    expect(
      await errorsOf(ServerIdsDto, { workspaceId: V7, serverId: V4 }),
    ).not.toEqual([]);
    const fp = `SHA256:${'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}`;
    expect(await errorsOf(TestServerDto, {})).toEqual([]);
    expect(await errorsOf(TestServerDto, { trustHostKey: fp })).toEqual([]);
    expect(
      await errorsOf(TestServerDto, { trustHostKey: 'AA'.repeat(40) }),
    ).not.toEqual([]);
    expect(
      await errorsOf(TestServerDto, { trustHostKey: 'SHA256:short' }),
    ).not.toEqual([]);
    expect(await errorsOf(TestServerDto, { trustHostKey: 42 })).not.toEqual([]);
  });
});

describe('server DTOs: search', () => {
  test('q тримится; пустой после trim, отсутствующий и длинный — 400', async () => {
    expect(plainToInstance(SearchServersDto, { q: '  prod  ' }).q).toBe('prod');
    expect(await errorsOf(SearchServersDto, { q: '   ' })).not.toEqual([]);
    expect(await errorsOf(SearchServersDto, { q: 'x'.repeat(65) })).not.toEqual(
      [],
    );
    expect(await errorsOf(SearchServersDto, {})).not.toEqual([]);
  });

  test('limit: целое 1..100, строка из query приводится к числу', async () => {
    expect(await errorsOf(SearchServersDto, { q: 'x', limit: 1 })).toEqual([]);
    expect(await errorsOf(SearchServersDto, { q: 'x', limit: 100 })).toEqual(
      [],
    );
    expect(
      await errorsOf(SearchServersDto, { q: 'x', limit: 0 }),
    ).not.toEqual([]);
    expect(
      await errorsOf(SearchServersDto, { q: 'x', limit: 101 }),
    ).not.toEqual([]);
    expect(plainToInstance(SearchServersDto, { q: 'x' }).limit).toBeUndefined();
    expect(plainToInstance(SearchServersDto, { q: 'x', limit: '20' }).limit).toBe(
      20,
    );
  });
});

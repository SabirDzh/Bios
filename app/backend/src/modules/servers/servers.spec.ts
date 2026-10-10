import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { ServerAuthType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { AppConfig } from '../../config/app.config';
import type { CreateServerDto } from './dto/create-server.dto';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { FakeSshRunner } from './ssh/fake-ssh.runner';
import { MEMBER_ROLES, ServersService } from './servers.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_servers?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

// ssh2 читает PKCS#1 и OpenSSH-формат, но не PKCS#8 — «валидный» ключ должен
// быть в том формате, который реально годится для подключения.
const REAL_PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

// Одноразовый тестовый ключ (passphrase 'test-passphrase'), сгенерирован
// ssh-keygen -t ed25519 -N: нужен ровно чтобы проверить отказ на зашифрованном
// ключе — панель не умеет спрашивать passphrase.
const ENCRYPTED_PEM = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABD3dGGCBb
oU4wcbDtB2PMzXAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIIllNEzwhuxp5LV7
p+lpS/nDEQvASJ0oL7sHS9utHxHXAAAAoGkt8xKdOPyFqvN3VZyPh4bIa5hLyjQe4Y/fkh
g5vyGFhdQ2tXrA+4gzR+fM2umD5hMhrb5RBlS8zmAp56YR/qYa/l06u5ubVlyz8rhqUxiO
Jn3xv0Ltd2bg7dpB49IucUd46rH7UU70hm7cjwpYV0RNzlvULZ74oeQk4Q9+oImitHsvri
4FNu+wF7pfP5y+KWeFBMWw0OTnEOcPao0iVI0=
-----END OPENSSH PRIVATE KEY-----
`;

export function testAppConfig(
  overrides: Partial<AppConfig['ssh']> = {},
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
    crypto: {
      activeKey: { id: 'k1', key: Buffer.alloc(32, 7) },
      oldKeys: new Map([['k0', Buffer.alloc(32, 6)]]),
      ephemeralServerKey: false,
    },
  } as AppConfig;
}

describe('servers module', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let credentials: CredentialCryptoService;
  let ssh: FakeSshRunner;
  let servers: ServersService;
  let ownerId: string;
  let workspaceId: string;
  let n = 0;

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(
      prisma,
      new TokensService(prisma),
      new SessionsService(prisma),
    );
    workspaces = new WorkspacesService(prisma);
    credentials = new CredentialCryptoService(testAppConfig());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ssh = new FakeSshRunner();
    servers = new ServersService(
      prisma,
      workspaces,
      credentials,
      ssh,
      testAppConfig(),
    );
    ownerId = (
      await users.create({
        username: `srvowner${n}`,
        email: `srvowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `srv-ws-${n}` }))
      .id;
  });

  afterEach(async () => {
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dtoFor(overrides: Partial<CreateServerDto> = {}): CreateServerDto {
    return {
      name: 'prod-1',
      host: '203.0.113.10',
      port: 22,
      sshUsername: 'deploy',
      authType: ServerAuthType.PASSWORD,
      sshPassword: 'sup3rsecret',
      ...overrides,
    };
  }

  async function extraUser(username: string): Promise<string> {
    return (
      await users.create({
        username,
        email: `${username}@example.com`,
        password: 'secret123',
      })
    ).id;
  }

  async function inviteAndAccept(email: string): Promise<string> {
    const invitation = await workspaces.invite(ownerId, workspaceId, email);
    const user = await users.create({
      username: email.split('@')[0],
      email,
      password: 'secret123',
    });
    await workspaces.accept(user.id, workspaceId, invitation.token);
    return user.id;
  }

  describe('CRUD', () => {
    test('create: cipher с активным kid, статус PENDING, без пина и без секрета в ответе', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      expect(created).toMatchObject({
        status: 'PENDING',
        authType: 'PASSWORD',
        hostKeyFingerprint: null,
        workspaceId,
      });
      expect(Object.keys(created)).not.toContain('secretCipher');
      expect(JSON.stringify(created)).not.toContain('sup3rsecret');

      const row = await prisma.server.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.secretCipher.startsWith('v1.k1.')).toBe(true);
      expect(row.secretCipher).not.toContain('sup3rsecret');
      expect(credentials.decrypt(row.secretCipher)).toBe('sup3rsecret');
      expect(row.hostKeyFingerprint).toBeNull();
      // создание не ходит в сеть
      expect(ssh.commands).toHaveLength(0);
    });

    test('create с PEM проходит структурную проверку ключа (не только regex)', async () => {
      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({
          authType: ServerAuthType.KEY,
          sshPassword: undefined,
          sshPrivateKey: REAL_PEM,
        }),
      );
      expect(created.authType).toBe('KEY');
      const row = await prisma.server.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(credentials.decrypt(row.secretCipher)).toBe(REAL_PEM);
    });

    test('create с фиктивным PEM вида AAAA — 400 до записи в БД (ревью №8)', async () => {
      await expect(
        servers.create(
          ownerId,
          workspaceId,
          dtoFor({
            authType: ServerAuthType.KEY,
            sshPassword: undefined,
            sshPrivateKey:
              '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n',
          }),
        ),
      ).rejects.toThrow('sshPrivateKey is not a valid private key');
      expect(await prisma.server.count()).toBe(0);
    });

    test('create с зашифрованным ключом — 400 с честным текстом', async () => {
      await expect(
        servers.create(
          ownerId,
          workspaceId,
          dtoFor({
            authType: ServerAuthType.KEY,
            sshPassword: undefined,
            sshPrivateKey: ENCRYPTED_PEM,
          }),
        ),
      ).rejects.toThrow('encrypted private keys are not supported');
      expect(await prisma.server.count()).toBe(0);
    });

    test('list/get: свои воркспейсы, чужой сервер и чужой воркспейс — 404 неотличимо', async () => {
      const mine = await servers.create(ownerId, workspaceId, dtoFor());
      const other = await workspaces.create(await extraUser('srvout1'), {
        name: 'other-ws',
      });

      expect(await servers.findAll(ownerId, workspaceId)).toHaveLength(1);
      await expect(servers.findAll(ownerId, other.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        await servers.findOne(ownerId, workspaceId, mine.id),
      ).toMatchObject({ id: mine.id });

      const outsider = await extraUser('srvout2');
      await expect(
        servers.findOne(outsider, workspaceId, mine.id),
      ).rejects.toThrow(NotFoundException);

      const foreignMember = await prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId: other.id },
      });
      const foreign = await servers.create(
        foreignMember.userId,
        other.id,
        dtoFor({ name: 'foreign' }),
      );
      await expect(
        servers.findOne(ownerId, workspaceId, foreign.id),
      ).rejects.toThrow(NotFoundException);
    });

    test('дубль имени — 409; без пина отпечаток NULL и второй сервер легален', async () => {
      await servers.create(ownerId, workspaceId, dtoFor());
      await expect(
        servers.create(ownerId, workspaceId, dtoFor()),
      ).rejects.toThrow(ConflictException);

      // Уникальность (workspaceId, hostKeyFingerprint) в PostgreSQL не считает
      // NULL равными, поэтому неопиленные серверы не конфликтуют — конфликт
      // возникает только на втором пине (тест в Task 9).
      const fp = `SHA256:${'A'.repeat(43)}`;
      await prisma.server.update({
        where: { workspaceId_name: { workspaceId, name: 'prod-1' } },
        data: { hostKeyFingerprint: fp },
      });
      await expect(
        servers.create(
          ownerId,
          workspaceId,
          dtoFor({ name: 'prod-2', host: '203.0.113.11' }),
        ),
      ).resolves.toMatchObject({ name: 'prod-2', hostKeyFingerprint: null });

      const ws2 = await workspaces.create(ownerId, { name: 'second' });
      await expect(
        servers.create(ownerId, ws2.id, dtoFor({ name: 'prod-1' })),
      ).resolves.toMatchObject({ workspaceId: ws2.id });
    });

    test('MEMBER видит список, но не создаёт сервер', async () => {
      const memberId = await inviteAndAccept('srvmember@example.com');
      await servers.create(ownerId, workspaceId, dtoFor());
      await expect(
        servers.create(memberId, workspaceId, dtoFor({ name: 'nope' })),
      ).rejects.toThrow(ForbiddenException);
      expect(await servers.findAll(memberId, workspaceId)).toHaveLength(1);
    });

    test('loadForSsh: битый cipher → 500, неизвестный kid → 500, секрета в команде нет', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      await prisma.server.update({
        where: { id: created.id },
        data: { secretCipher: 'garbage' },
      });
      await expect(
        servers.loadForSsh(
          ownerId,
          workspaceId,
          created.id,
          MEMBER_ROLES,
          'probe',
        ),
      ).rejects.toThrow('server credential unreadable');

      await prisma.server.update({
        where: { id: created.id },
        data: {
          secretCipher:
            'v1.kz.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAA',
        },
      });
      await expect(
        servers.loadForSsh(
          ownerId,
          workspaceId,
          created.id,
          MEMBER_ROLES,
          'probe',
        ),
      ).rejects.toThrow('server credential unreadable');
      ssh.assertNoSecretLeak('sup3rsecret');
    });

    test('перевёртка ключа: cipher старого kid после успешного чтения получает активный kid', async () => {
      const before = new CredentialCryptoService({
        ssh: testAppConfig().ssh,
        crypto: {
          activeKey: { id: 'k0', key: Buffer.alloc(32, 6) },
          oldKeys: new Map(),
          ephemeralServerKey: false,
        },
      } as AppConfig);
      const cipherWithOldKid = before.encrypt('sup3rsecret');
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      await prisma.server.update({
        where: { id: created.id },
        data: { secretCipher: cipherWithOldKid },
      });
      expect(cipherWithOldKid.startsWith('v1.k0.')).toBe(true);

      const { session } = await servers.loadForSsh(
        ownerId,
        workspaceId,
        created.id,
        MEMBER_ROLES,
        'probe',
      );
      expect(session.secret).toBe('sup3rsecret');
      const row = await prisma.server.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.secretCipher.startsWith('v1.k1.')).toBe(true);
      expect(credentials.decrypt(row.secretCipher)).toBe('sup3rsecret');
    });

    test('hostKeyFingerprint в сессии: probe → null, authenticated без пина → 424', async () => {
      const created = await servers.create(ownerId, workspaceId, dtoFor());
      const probe = await servers.loadForSsh(
        ownerId,
        workspaceId,
        created.id,
        MEMBER_ROLES,
        'probe',
      );
      expect(probe.session.expectedHostKeyFingerprint).toBeNull();
      expect(probe.session.address).toBe('203.0.113.10');

      await expect(
        servers.loadForSsh(
          ownerId,
          workspaceId,
          created.id,
          MEMBER_ROLES,
          'authenticated',
        ),
      ).rejects.toMatchObject({
        status: 424,
        response: { errorCode: 'HOST_KEY_NOT_TRUSTED' },
      });

      await prisma.server.update({
        where: { id: created.id },
        data: { hostKeyFingerprint: `SHA256:${'B'.repeat(43)}` },
      });
      const pinned = await servers.loadForSsh(
        ownerId,
        workspaceId,
        created.id,
        MEMBER_ROLES,
        'authenticated',
      );
      expect(pinned.session.expectedHostKeyFingerprint).toBe(
        `SHA256:${'B'.repeat(43)}`,
      );
    });

    test('запрещённый порт: 400 на create и всё равно блокируется на подключении', async () => {
      await expect(
        servers.create(ownerId, workspaceId, dtoFor({ port: 23 })),
      ).rejects.toThrow(BadRequestException);
      expect(await prisma.server.count()).toBe(0);

      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({ port: 22 }),
      );
      const strict = new ServersService(
        prisma,
        workspaces,
        credentials,
        ssh,
        testAppConfig({ allowedPorts: [2202] }),
      );
      await expect(
        strict.loadForSsh(
          ownerId,
          workspaceId,
          created.id,
          MEMBER_ROLES,
          'probe',
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'PORT_NOT_ALLOWED' } });
      expect(ssh.commands).toHaveLength(0);
    });

    test('запрещённый адрес (метаданные облака) блокируется до обращения к каналу', async () => {
      const created = await servers.create(
        ownerId,
        workspaceId,
        dtoFor({ host: '169.254.169.254' }),
      );
      await expect(
        servers.loadForSsh(
          ownerId,
          workspaceId,
          created.id,
          MEMBER_ROLES,
          'probe',
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'TARGET_BLOCKED' } });
      expect(ssh.commands).toHaveLength(0);
    });
  });
});

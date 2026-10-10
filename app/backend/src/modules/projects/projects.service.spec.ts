import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';
import {
  assertContainerName,
  assertGitRef,
  assertPortMappings,
  assertPublicHttpsRepoUrl,
  assertRelativeFilePath,
} from './project.types';

describe('repoUrl — только публичный HTTPS', () => {
  test(' принимает обычные https-репозитории и нормализует только хост', () => {
    expect(
      assertPublicHttpsRepoUrl('https://GitHub.com/octocat/Hello-World.git'),
    ).toBe('https://github.com/octocat/Hello-World.git');
    expect(assertPublicHttpsRepoUrl('https://gitlab.com/group/sub/repo')).toBe(
      'https://gitlab.com/group/sub/repo',
    );
    expect(assertPublicHttpsRepoUrl(' https://host.example/a/b ')).toBe(
      'https://host.example/a/b',
    );
  });

  test(' регистр пути сохраняется: репозиторий Group/MyRepo ≠ group/myrepo', () => {
    // замер (Node 24, WHATWG URL): new URL('https://GitHub.com/Owner/Repo.Git')
    // даёт hostname 'github.com' и pathname '/Owner/Repo.Git' — путь сам по
    // себе не меняется, а toLowerCase() всей строки его портил
    expect(assertPublicHttpsRepoUrl('https://gitlab.com/Team/MyApp.git')).toBe(
      'https://gitlab.com/Team/MyApp.git',
    );
  });

  test(' отклоняет credentials в URL: секрет не имеет права попадать в БД', () => {
    for (const bad of [
      'https://user:token@github.com/a/b.git',
      'https://x-oauth-basic@github.com/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет не-https, shell-метасимволы и адреса вне диапазона портов', () => {
    for (const bad of [
      'http://github.com/a/b',
      'git@github.com:a/b.git',
      'https://github.com/a/b; rm -rf /',
      'https://github.com/a/$(id)',
      "https://github.com/a/'b",
      'https://github.com/a b',
      'https:///a',
      'x'.repeat(501),
      // порт: 5 цифр из прошлой регулярки пропускали 99999, и new URL бросал
      // TypeError → 500 вместо 400 (замер: URL THROWS: TypeError)
      'https://github.com:99999/a/b',
      'https://github.com:65536/a/b',
      'https://github.com:0/a/b',
      'https://github.com:00080/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет адресные цели, чтобы хост не ходил в link-local', () => {
    for (const bad of [
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/a/b',
      'https://127.0.0.1:8443/a/b',
      'https://0/a',
      'https://[::1]/a/b',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });

  test(' отклоняет приватные имена и хосты без точки', () => {
    for (const bad of [
      'https://git.internal/a/b',
      'https://host.local/a/b',
      'https://srv.corp/a/b',
      'https://box.lan/a/b',
      'https://git/a',
    ]) {
      expect(() => assertPublicHttpsRepoUrl(bad)).toThrow(BadRequestException);
    }
  });
});

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_deploy?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('ProjectsService', () => {
  let prisma: PrismaService;
  let users: UsersService;
  let workspaces: WorkspacesService;
  let projects: ProjectsService;
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
    projects = new ProjectsService(prisma, workspaces);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    n += 1;
    ownerId = (
      await users.create({
        username: `pjowner${n}`,
        email: `pjowner${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    workspaceId = (await workspaces.create(ownerId, { name: `pj-ws-${n}` })).id;
  });

  afterEach(async () => {
    await prisma.deployment.deleteMany({});
    await prisma.deployConfig.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.server.deleteMany({});
    await prisma.workspaceInvitation.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  function dto(overrides: Partial<CreateProjectDto> = {}): CreateProjectDto {
    return {
      name: 'shop',
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      ...overrides,
    };
  }

  async function member(userId: string): Promise<void> {
    await prisma.workspaceMember.create({
      data: { workspaceId, userId, role: 'MEMBER' },
    });
  }

  test('create: OWNER, хост нормализован, путь сохранён, секретов в ответе нет', async () => {
    const created = await projects.create(
      ownerId,
      workspaceId,
      dto({ repoUrl: 'https://GitHub.com/octocat/Hello-World.git' }),
    );
    expect(created).toMatchObject({
      workspaceId,
      name: 'shop',
      // путь НЕ приводится к нижнему регистру: для git-сервера Group/MyRepo и
      // group/myrepo — разные репозитории
      repoUrl: 'https://github.com/octocat/Hello-World.git',
    });
    expect(JSON.stringify(created)).not.toContain('token');
  });

  test('create: MEMBER — 403, строки нет', async () => {
    const other = (
      await users.create({
        username: `pjmem${n}`,
        email: `pjmem${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await member(other);
    await expect(
      projects.create(other, workspaceId, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.project.count()).toBe(0);
  });

  test('create: чужой workspace — 404, а не «создам в чужом»', async () => {
    const stranger = (
      await users.create({
        username: `pjstr${n}`,
        email: `pjstr${n}@example.com`,
        password: 'secret123',
      })
    ).id;
    await expect(
      projects.create(stranger, workspaceId, dto()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('create: битый repoUrl — 400 до записи', async () => {
    await expect(
      projects.create(
        ownerId,
        workspaceId,
        dto({ repoUrl: 'http://github.com/a/b' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.project.count()).toBe(0);
  });

  test('create: дубликат имени в воркспейсе — 409', async () => {
    await projects.create(ownerId, workspaceId, dto());
    await expect(
      projects.create(
        ownerId,
        workspaceId,
        dto({ repoUrl: 'https://gitlab.com/a/b' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('list и findOne: только свои проекты, чужому — 404', async () => {
    const mine = await projects.create(ownerId, workspaceId, dto());
    expect(await projects.findAll(ownerId, workspaceId)).toEqual([
      expect.objectContaining({ id: mine.id }),
    ]);
    const otherWs = await workspaces.create(ownerId, { name: 'pj-other' });
    await expect(
      projects.findOne(ownerId, otherWs.id, mine.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      projects.findOne(ownerId, workspaceId, mine.id),
    ).resolves.toMatchObject({ id: mine.id });
  });
});

describe('валидаторы конфигурации деплоя', () => {
  test('ref: ветки и теги проходят, синтаксис git — нет', () => {
    for (const ok of ['main', 'release/1.2', 'v1.2.3-rc1', 'my_branch']) {
      expect(assertGitRef(ok)).toBe(ok);
    }
    for (const bad of [
      '-F',
      '..secret',
      'a/..b',
      'HEAD~1',
      'main^',
      '@{0}',
      '',
      ' ',
      'a b',
      'x'.repeat(101),
    ]) {
      expect(() => assertGitRef(bad)).toThrow(BadRequestException);
    }
  });

  test('dockerfile: только относительный путь внутри репозитория', () => {
    expect(assertRelativeFilePath('Dockerfile')).toBe('Dockerfile');
    expect(assertRelativeFilePath('docker/Dockerfile.prod')).toBe(
      'docker/Dockerfile.prod',
    );
    for (const bad of [
      '/etc/passwd',
      '../Dockerfile',
      './$(id)',
      'a b',
      '-Dockerfile',
      'x'.repeat(121),
    ]) {
      expect(() => assertRelativeFilePath(bad)).toThrow(BadRequestException);
    }
  });

  test('containerName и ports: правила docker', () => {
    expect(assertContainerName('shop-web_1')).toBe('shop-web_1');
    for (const bad of ['-name', 'a b', 'a/b', 'a;rm', '', 'x'.repeat(65)]) {
      expect(() => assertContainerName(bad)).toThrow(BadRequestException);
    }
    expect(assertPortMappings(['8080:80', '9000:443/tcp'])).toEqual([
      '8080:80',
      '9000:443/tcp',
    ]);
    expect(assertPortMappings(undefined)).toEqual([]);
    for (const bad of [
      '0:80',
      '80:0',
      '99999:80',
      '8080:80:80',
      'http',
      '8080:80 /udp',
      "8080:80'",
    ]) {
      expect(() => assertPortMappings([bad])).toThrow(BadRequestException);
    }
  });

  test('дубли хост-порта отклоняются по нормализованному значению', () => {
    expect(() => assertPortMappings(['8080:80', '8080:443'])).toThrow(
      BadRequestException,
    );
    // ведущие нули — тот же порт, и docker отказал бы с тем же текстом
    expect(() => assertPortMappings(['08080:80', '8080:443'])).toThrow(
      BadRequestException,
    );
    // разные протоколы одного хост-порта docker разрешает
    expect(assertPortMappings(['8080:80/tcp', '8080:80/udp'])).toEqual([
      '8080:80/tcp',
      '8080:80/udp',
    ]);
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuthService } from './auth.service';
import { JwtTokenService } from './jwt-token.service';
import { JwtStrategy } from './guards/jwt.strategy';
import { loadAuthConfig, type AuthConfig } from './auth.config';

const TEST_DB_URL = 'postgresql://sabir@localhost:5432/bios_test?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('auth rotation lifecycle (postgres)', () => {
  let prisma: PrismaService;
  let config: AuthConfig;
  let jwtTokens: JwtTokenService;
  let sessions: SessionsService;
  let users: UsersService;
  let auth: AuthService;
  let strategy: JwtStrategy;
  let n = 0;

  beforeAll(() => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    config = loadAuthConfig({
      NODE_ENV: 'test',
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
    });
    prisma = new PrismaService();
    const tokensService = new TokensService(prisma);
    sessions = new SessionsService(prisma);
    users = new UsersService(prisma, tokensService, sessions);
    jwtTokens = new JwtTokenService(new JwtService({}), config);
    auth = new AuthService(users, sessions, jwtTokens, config);
    strategy = new JwtStrategy(config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function registerUser() {
    n += 1;
    const user = await users.create({
      username: `rotuser${n}`,
      email: `rotuser${n}@example.com`,
      password: 'secret123',
    });
    return user;
  }

  afterEach(async () => {
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  async function activeSessionsCount(userId: string): Promise<number> {
    return prisma.refreshSession.count({ where: { userId, status: 'ACTIVE' } });
  }

  test('login issues pair and stores ACTIVE session', async () => {
    const user = await registerUser();
    const pair = await auth.login({ email: user.email, password: 'secret123' });
    const access = jwtTokens.verifyAccess(pair.accessToken);
    const refresh = jwtTokens.verifyRefresh(pair.refreshToken);
    expect(access.sub).toBe(user.id);
    expect(refresh.sub).toBe(user.id);
    expect(access.sid).toBe(refresh.sid);
    expect(access.jti).not.toBe(refresh.jti);
    expect(await activeSessionsCount(user.id)).toBe(1);
  });

  test('R1 rotates to A2/R2 with new jti, same family; R1 dead', async () => {
    const user = await registerUser();
    const { refreshToken: r1 } = await auth.login({
      email: user.email,
      password: 'secret123',
    });
    const r1claims = jwtTokens.verifyRefresh(r1);

    const pair2 = await auth.refresh(r1);
    const r2claims = jwtTokens.verifyRefresh(pair2.refreshToken);
    expect(r2claims.jti).not.toBe(r1claims.jti);
    expect(r2claims.sid).toBe(r1claims.sid);
    jwtTokens.verifyAccess(pair2.accessToken);

    const oldRow = await prisma.refreshSession.findUnique({
      where: { jti: r1claims.jti },
    });
    expect(oldRow?.status).toBe('USED');
    await expect(auth.refresh(r1)).rejects.toThrow(UnauthorizedException);
  });

  test('R1 reuse after rotation revokes whole family (R2 dies too)', async () => {
    const user = await registerUser();
    const { refreshToken: r1 } = await auth.login({
      email: user.email,
      password: 'secret123',
    });
    const { refreshToken: r2 } = await auth.refresh(r1);

    await expect(auth.refresh(r1)).rejects.toThrow(UnauthorizedException);
    expect(await activeSessionsCount(user.id)).toBe(0);
    await expect(auth.refresh(r2)).rejects.toThrow(UnauthorizedException);
  });

  test('concurrent double rotation: exactly one wins, no two live pairs', async () => {
    const user = await registerUser();
    const { refreshToken: r1 } = await auth.login({
      email: user.email,
      password: 'secret123',
    });

    const results = await Promise.allSettled([
      auth.refresh(r1),
      auth.refresh(r1),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // Строгая политика: проигравший увидел USED и отозвал семейство.
    expect(await activeSessionsCount(user.id)).toBe(0);
  });

  test('logout revokes family', async () => {
    const user = await registerUser();
    const pair = await auth.login({ email: user.email, password: 'secret123' });
    const access = jwtTokens.verifyAccess(pair.accessToken);
    await auth.logout({
      userId: user.id,
      username: user.username,
      email: user.email,
      sid: access.sid,
    });
    expect(await activeSessionsCount(user.id)).toBe(0);
    await expect(auth.refresh(pair.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  test('password change revokes all families', async () => {
    const user = await registerUser();
    const p1 = await auth.login({ email: user.email, password: 'secret123' });
    const p2 = await auth.login({ email: user.email, password: 'secret123' });
    expect(await activeSessionsCount(user.id)).toBe(2);

    await users.changePassword(user.id, {
      password: 'secret123',
      newPassword: 'newsecret123',
    });
    expect(await activeSessionsCount(user.id)).toBe(0);
    await expect(auth.refresh(p1.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(auth.refresh(p2.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    // Новый пароль работает.
    const p3 = await auth.login({
      email: user.email,
      password: 'newsecret123',
    });
    expect(p3.accessToken).toBeTruthy();
  });

  test('strategy accepts access, rejects refresh as access', async () => {
    const user = await registerUser();
    const pair = await auth.login({ email: user.email, password: 'secret123' });
    const accessPayload = JSON.parse(
      Buffer.from(pair.accessToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    const refreshPayload = JSON.parse(
      Buffer.from(pair.refreshToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    const result = strategy.validate(accessPayload);
    expect(result.userId).toBe(user.id);
    expect(result.sid).toBeTruthy();
    expect(() => strategy.validate(refreshPayload)).toThrow(
      UnauthorizedException,
    );
  });

  test('forged refresh (other key) is rejected, no side effects', async () => {
    const user = await registerUser();
    const { refreshToken: r1 } = await auth.login({
      email: user.email,
      password: 'secret123',
    });
    const foreignKeys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const foreignTokens = new JwtTokenService(new JwtService({}), {
      ...config,
      privateKey: foreignKeys.privateKey,
      publicKey: foreignKeys.publicKey,
    });
    const forged = foreignTokens.signRefresh({
      userId: user.id,
      familyId: 'fake',
      jti: 'fake',
    });
    await expect(auth.refresh(forged)).rejects.toThrow(UnauthorizedException);
    // Легитимный токен жив.
    const pair2 = await auth.refresh(r1);
    expect(pair2.accessToken).toBeTruthy();
  });

  test('DB failure never issues tokens', async () => {
    const user = await registerUser();
    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      'postgresql://sabir@localhost:59999/bios_test?schema=public';
    const brokenPrisma = new PrismaService();
    const brokenSessions = new SessionsService(brokenPrisma);
    const brokenAuth = new AuthService(
      users,
      brokenSessions,
      jwtTokens,
      config,
    );
    try {
      await expect(
        brokenAuth.login({ email: user.email, password: 'secret123' }),
      ).rejects.toThrow();
      const { refreshToken: r1 } = await auth.login({
        email: user.email,
        password: 'secret123',
      });
      await expect(brokenAuth.refresh(r1)).rejects.toThrow();
    } finally {
      process.env.DATABASE_URL = prevUrl;
      await brokenPrisma.$disconnect().catch(() => undefined);
    }
  });

  test('unknown email on login gives 401 like wrong password (no enumeration)', async () => {
    const user = await registerUser();
    await expect(
      auth.login({ email: 'nobody@example.com', password: 'secret123' }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      auth.login({ email: user.email, password: 'wrongpass1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  test('recovery for unknown email returns same message (no enumeration)', async () => {
    const known = await users.requestRecovery('ghost@example.com');
    const user = await registerUser();
    const existing = await users.requestRecovery(user.email);
    expect(known).toEqual(existing);
  });

  test('gmail aliases collapse to one account (canonicalEmail)', async () => {
    n += 1;
    const k = n;
    const first = await users.create({
      username: `aliasuser${k}`,
      email: `alias.test${k}+spam@gmail.com`,
      password: 'secret123',
    });
    expect(first.canonicalEmail).toBe(`aliastest${k}@gmail.com`);
    // Тот же ящик в другой алиасной форме — дубль, та же 400, что и обычно.
    await expect(
      users.create({
        username: `aliasuser${k}x`,
        email: `aliasTest${k}@gmail.com`,
        password: 'secret123',
      }),
    ).rejects.toThrow();
    // Login и recovery находят аккаунт по любой алиасной форме.
    const pair = await auth.login({
      email: `a.l.i.a.s.t.e.s.t${k}+other@gmail.com`,
      password: 'secret123',
    });
    expect(jwtTokens.verifyAccess(pair.accessToken).sub).toBe(first.id);
    await expect(
      users.requestRecovery(`aliastest${k}@gmail.com`),
    ).resolves.toEqual({ message: 'Recovery email have been send' });
  });

  test('expired confirm token is rejected and removed', async () => {
    const user = await registerUser();
    const expired = await prisma.token.create({
      data: {
        userId: user.id,
        type: 'CONFIRM',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(users.confirm(expired.id)).rejects.toThrow();
    await expect(
      prisma.token.findUnique({ where: { id: expired.id } }),
    ).resolves.toBeNull();
  });

  test('concurrent recovery: exactly one wins (S4, delete-first)', async () => {
    const user = await registerUser();
    const token = await prisma.token.create({
      data: {
        userId: user.id,
        type: 'RECOVERY',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const dto = { password: 'newsecret1', confirmPassword: 'newsecret1' };
    const results = await Promise.allSettled([
      users.recoveryPassword(token.id, dto),
      users.recoveryPassword(token.id, dto),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

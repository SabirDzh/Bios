import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma/prisma.service';
import { loadAppConfig } from '../../config/app.config';
import { MaintenanceService, PURGE_JOB_NAME } from './maintenance.service';

const TEST_DB_URL =
  'postgresql://sabir@localhost:5432/bios_test_maintenance?schema=public';
process.env.DATABASE_URL = TEST_DB_URL;

describe('MaintenanceService.purgeExpired', () => {
  let prisma: PrismaService;
  let maintenance: MaintenanceService;
  let registry: SchedulerRegistry;

  beforeAll(() => {
    prisma = new PrismaService();
    registry = new SchedulerRegistry();
    maintenance = new MaintenanceService(
      prisma,
      registry,
      loadAppConfig({ ...process.env, NODE_ENV: 'test' }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.refreshSession.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.user.deleteMany({});
  });

  test('removes expired tokens and stale non-active sessions, keeps live ones', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'janitor',
        email: 'janitor@example.com',
        password: 'x'.repeat(60),
      },
    });
    const past = new Date(Date.now() - 1000);
    const ancient = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.token.create({
      data: { userId: user.id, type: 'RECOVERY', expiresAt: past },
    });
    await prisma.token.create({
      data: {
        userId: user.id,
        type: 'CONFIRM',
        expiresAt: new Date(Date.now() + 99999),
      },
    });
    await prisma.refreshSession.create({
      data: {
        jti: 'stale-used',
        familyId: 'f1',
        userId: user.id,
        tokenHash: 'h',
        status: 'USED',
        expiresAt: new Date(Date.now() + 99999),
        usedAt: ancient,
      },
    });
    await prisma.refreshSession.create({
      data: {
        jti: 'live-active',
        familyId: 'f1',
        userId: user.id,
        tokenHash: 'h',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 99999),
      },
    });

    const result = await maintenance.purgeExpired();
    expect(result).toEqual({ tokens: 1, sessions: 1 });
    expect(await prisma.token.count()).toBe(1);
    expect(
      await prisma.refreshSession.findUnique({ where: { jti: 'live-active' } }),
    ).toBeTruthy();
  });

  test('onModuleInit registers the purge job with config cron and timezone', () => {
    maintenance.onModuleInit();
    expect(registry.getCronJobs().has(PURGE_JOB_NAME)).toBe(true);
  });
});

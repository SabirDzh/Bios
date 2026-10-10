import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '../../config/app.config';
import { ThrottleProfile } from './throttle-profile.decorator';
import { buildThrottlerOptions } from './throttle-options.factory';

class Dummy {
  // `this: void` — методы отдаются ctxFor() вне объекта, правилу нужен этот контракт.
  @ThrottleProfile('authStrict')
  strict(this: void) {}

  @ThrottleProfile('sshOps')
  ssh(this: void) {}

  @ThrottleProfile('dockerReads')
  reads(this: void) {}

  plain(this: void) {}
}

describe('buildThrottlerOptions', () => {
  const cfg = {
    throttle: {
      global: { limit: 120, ttlMs: 60000 },
      authStrict: { limit: 10, ttlMs: 60000 },
      recovery: { limit: 5, ttlMs: 60000 },
      invite: { limit: 30, ttlMs: 60000 },
      sshOps: { limit: 6, ttlMs: 60000 },
      dockerReads: { limit: 60, ttlMs: 60000 },
    },
  } as AppConfig;
  const reflector = new Reflector();

  function ctxFor(fn: (...args: never[]) => unknown): ExecutionContext {
    return {
      getHandler: () => fn,
      getClass: () => Dummy,
    } as unknown as ExecutionContext;
  }

  test('builds 6 named throttlers with config values (ttlMs -> ttl)', () => {
    const { throttlers } = buildThrottlerOptions(cfg, reflector);
    expect(throttlers.map((t) => [t.name, t.limit, t.ttl])).toEqual([
      ['global', 120, 60000],
      ['authStrict', 10, 60000],
      ['recovery', 5, 60000],
      ['invite', 30, 60000],
      ['sshOps', 6, 60000],
      ['dockerReads', 60, 60000],
    ]);
  });

  test('named profile skipped everywhere except its routes', () => {
    const { throttlers } = buildThrottlerOptions(cfg, reflector);
    const auth = throttlers.find((t) => t.name === 'authStrict')?.skipIf;
    expect(auth).toBeDefined();
    expect(auth?.(ctxFor(Dummy.prototype.strict))).toBe(false);
    expect(auth?.(ctxFor(Dummy.prototype.plain))).toBe(true);

    const sshOps = throttlers.find((t) => t.name === 'sshOps')?.skipIf;
    expect(sshOps).toBeDefined();
    expect(sshOps?.(ctxFor(Dummy.prototype.plain))).toBe(true);
    expect(sshOps?.(ctxFor(Dummy.prototype.ssh))).toBe(false);

    const dockerReads = throttlers.find(
      (t) => t.name === 'dockerReads',
    )?.skipIf;
    expect(dockerReads).toBeDefined();
    expect(dockerReads?.(ctxFor(Dummy.prototype.plain))).toBe(true);
    expect(dockerReads?.(ctxFor(Dummy.prototype.reads))).toBe(false);
  });
});

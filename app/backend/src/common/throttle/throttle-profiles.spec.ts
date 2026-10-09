import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '../../config/app.config';
import { ThrottleProfile } from './throttle-profile.decorator';
import { buildThrottlerOptions } from './throttle-options.factory';

class Dummy {
  @ThrottleProfile('authStrict')
  strict() {}

  plain() {}
}

describe('buildThrottlerOptions', () => {
  const cfg = {
    throttle: {
      global: { limit: 120, ttlMs: 60000 },
      authStrict: { limit: 10, ttlMs: 60000 },
      recovery: { limit: 5, ttlMs: 60000 },
      invite: { limit: 30, ttlMs: 60000 },
    },
  } as AppConfig;
  const reflector = new Reflector();

  function ctxFor(fn: (...args: never[]) => unknown): ExecutionContext {
    return {
      getHandler: () => fn,
      getClass: () => Dummy,
    } as ExecutionContext;
  }

  test('builds 4 named throttlers with config values (ttlMs -> ttl)', () => {
    const { throttlers } = buildThrottlerOptions(cfg, reflector);
    expect(throttlers.map((t) => [t.name, t.limit, t.ttl])).toEqual([
      ['global', 120, 60000],
      ['authStrict', 10, 60000],
      ['recovery', 5, 60000],
      ['invite', 30, 60000],
    ]);
  });

  test('named profile skipped everywhere except its routes', () => {
    const { throttlers } = buildThrottlerOptions(cfg, reflector);
    const auth = throttlers.find((t) => t.name === 'authStrict')?.skipIf;
    expect(auth).toBeDefined();
    expect(auth?.(ctxFor(Dummy.prototype.strict))).toBe(false);
    expect(auth?.(ctxFor(Dummy.prototype.plain))).toBe(true);
  });
});

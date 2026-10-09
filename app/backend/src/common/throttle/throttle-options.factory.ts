import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type {
  AppConfig,
  ThrottleProfileCfg,
  ThrottleProfileName,
} from '../../config/app.config';
import { THROTTLE_PROFILE_KEY } from './throttle-profile.decorator';

export interface NamedThrottler {
  name: string;
  limit: number;
  ttl: number;
  blockDuration?: number;
  skipIf?: (context: ExecutionContext) => boolean;
}

function profileOf(reflector: Reflector, context: ExecutionContext) {
  return reflector.getAllAndOverride<ThrottleProfileName | undefined>(
    THROTTLE_PROFILE_KEY,
    [context.getHandler(), context.getClass()],
  );
}

/**
 * Строит именованные throttler'ы из AppConfig.
 * global действует везде; именованный профиль — только на роутах
 * с @ThrottleProfile (остальные его пропускают через skipIf).
 */
export function buildThrottlerOptions(
  cfg: AppConfig,
  reflector: Reflector,
): { throttlers: NamedThrottler[] } {
  const skipUnless =
    (name: ThrottleProfileName) =>
    (context: ExecutionContext): boolean =>
      profileOf(reflector, context) !== name;
  // Маппинг ttlMs -> ttl: библиотека ждёт поле `ttl` (мс).
  const entry = (name: string, p: ThrottleProfileCfg): NamedThrottler => ({
    name,
    limit: p.limit,
    ttl: p.ttlMs,
  });
  return {
    throttlers: [
      entry('global', cfg.throttle.global),
      {
        ...entry('authStrict', cfg.throttle.authStrict),
        skipIf: skipUnless('authStrict'),
      },
      {
        ...entry('recovery', cfg.throttle.recovery),
        skipIf: skipUnless('recovery'),
      },
      { ...entry('invite', cfg.throttle.invite), skipIf: skipUnless('invite') },
      {
        ...entry('sshOps', cfg.throttle.sshOps),
        skipIf: skipUnless('sshOps'),
      },
    ],
  };
}

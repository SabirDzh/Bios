import { SetMetadata } from '@nestjs/common';
import type { ThrottleProfileName } from '../../config/app.config';

export const THROTTLE_PROFILE_KEY = 'throttle-profile';

/**
 * Привязывает роут к именованному throttle-профилю из AppConfig.
 * Семантика additional: действуют global-профиль И выбранный, effective = min.
 */
export const ThrottleProfile = (profile: ThrottleProfileName) =>
  SetMetadata(THROTTLE_PROFILE_KEY, profile);

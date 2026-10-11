import {
  CircleCheck,
  CircleDashed,
  Loader2,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/**
 * Презентационное представление доменного статуса: тон, глиф, русская
 * подпись. Значения — словари бэкенда (docs/icc-api-matrix.md); неизвестное
 * значение показывается как есть, нейтральным тоном (правило «не подменяем»).
 */
export interface StatusMeta {
  tone: StatusTone;
  label: string;
  icon: LucideIcon;
  /** Активный процесс: глиф вращается. */
  spin?: boolean;
  /** Исходное значение из API — для title. */
  title: string;
}

function meta(
  tone: StatusTone,
  label: string,
  icon: LucideIcon,
  raw: string,
  spin?: boolean,
): StatusMeta {
  return { tone, label, icon, spin, title: raw };
}

function unknown(raw: string): StatusMeta {
  return meta('neutral', raw, CircleDashed, raw);
}

/** Server.status: PENDING / ONLINE / OFFLINE. */
export function serverStatus(raw: string): StatusMeta {
  switch (raw) {
    case 'ONLINE':
      return meta('ok', 'онлайн', CircleCheck, raw);
    case 'OFFLINE':
      return meta('neutral', 'офлайн', CircleDashed, raw);
    case 'PENDING':
      return meta('info', 'ожидает проверки', Loader2, raw);
    default:
      return unknown(raw);
  }
}

/** Agent.status: NOT_INSTALLED / FAILED / STALE / ACTIVE. */
export function agentStatus(raw: string): StatusMeta {
  switch (raw) {
    case 'ACTIVE':
      return meta('ok', 'активен', CircleCheck, raw);
    case 'STALE':
      return meta('warn', 'устарел', TriangleAlert, raw);
    case 'FAILED':
      return meta('danger', 'сбой', OctagonX, raw);
    case 'NOT_INSTALLED':
      return meta('neutral', 'не установлен', CircleDashed, raw);
    default:
      return unknown(raw);
  }
}

/** Deployment.status: QUEUED / RUNNING / SUCCESS / FAILED / INTERRUPTED. */
export function deploymentStatus(raw: string): StatusMeta {
  switch (raw) {
    case 'QUEUED':
      return meta('neutral', 'в очереди', CircleDashed, raw);
    case 'RUNNING':
      return meta('info', 'выполняется', Loader2, raw, true);
    case 'SUCCESS':
      return meta('ok', 'успех', CircleCheck, raw);
    case 'FAILED':
      return meta('danger', 'ошибка', OctagonX, raw);
    case 'INTERRUPTED':
      return meta('warn', 'прерван', TriangleAlert, raw);
    default:
      return unknown(raw);
  }
}

/** Container.state — Docker-значения; незнакомые показываются как есть. */
export function containerState(raw: string): StatusMeta {
  switch (raw) {
    case 'running':
      return meta('ok', 'работает', CircleCheck, raw);
    case 'exited':
      return meta('neutral', 'остановлен', CircleDashed, raw);
    case 'created':
      return meta('neutral', 'создан', CircleDashed, raw);
    case 'restarting':
      return meta('warn', 'перезапускается', TriangleAlert, raw);
    case 'paused':
      return meta('warn', 'приостановлен', TriangleAlert, raw);
    case 'dead':
      return meta('danger', 'упал', OctagonX, raw);
    default:
      return unknown(raw);
  }
}

/** Фазы исполнения деплоя в порядке конвейера (протокол — lowercase). */
export const DEPLOY_STEPS = ['preflight', 'source', 'build', 'run'] as const;

const STEP_LABELS: Record<string, string> = {
  preflight: 'Проверка',
  source: 'Исходники',
  build: 'Сборка',
  run: 'Запуск',
};

/** Русская подпись фазы; исходное значение остаётся в title. */
export function deployStepLabel(step: string | null | undefined): string | null {
  return step ? (STEP_LABELS[step] ?? step) : null;
}

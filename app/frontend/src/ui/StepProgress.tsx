import {
  CircleCheck,
  CircleDashed,
  Loader2,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import { DEPLOY_STEPS, deployStepLabel } from '../lib/statusMeta';
import './StepProgress.css';

export interface StepProgressProps {
  /** Текущая фаза из API (lowercase); null, пока задача в очереди. */
  step: string | null;
  /** Статус деплоя: QUEUED / RUNNING / SUCCESS / FAILED / INTERRUPTED. */
  status: string;
}

type StepState = 'done' | 'active' | 'future';

/**
 * Тон активного шага — от исхода: упавший шаг красный, прерванный жёлтый,
 * идущий синий. QUEUED с непустым step — теоретический случай, остаётся
 * нейтральным, а не выдумывает процесс.
 */
function activeTone(status: string): string {
  if (status === 'FAILED') return 'danger';
  if (status === 'INTERRUPTED') return 'warn';
  return status === 'RUNNING' ? 'info' : 'neutral';
}

function StepIcon({ state, status }: { state: StepState; status: string }) {
  if (state === 'done') return <CircleCheck size={14} aria-hidden />;
  if (state === 'active') {
    if (status === 'FAILED') return <OctagonX size={14} aria-hidden />;
    if (status === 'INTERRUPTED') return <TriangleAlert size={14} aria-hidden />;
    return <Loader2 size={14} className="spin" aria-hidden />;
  }
  return <CircleDashed size={14} aria-hidden />;
}

function stateText(state: StepState, status: string): string {
  if (state === 'done') return 'выполнен';
  if (state === 'future') return 'ожидает';
  if (status === 'FAILED') return 'ошибка на этом шаге';
  if (status === 'INTERRUPTED') return 'прервано на этом шаге';
  return 'текущий';
}

/**
 * Конвейер фаз деплоя. Незнакомый шаг не прячется: показывается хвостом
 * с сырым именем — правило «не подменяем» из statusMeta.
 */
export function StepProgress({ step, status }: StepProgressProps) {
  const allDone = status === 'SUCCESS';
  const curIndex = step ? (DEPLOY_STEPS as readonly string[]).indexOf(step) : -1;

  const items = DEPLOY_STEPS.map((name, i) => {
    const state: StepState =
      allDone || (curIndex >= 0 && i < curIndex)
        ? 'done'
        : i === curIndex
          ? 'active'
          : 'future';
    return { key: name as string, label: deployStepLabel(name) ?? name, state };
  });
  if (step !== null && curIndex === -1) {
    items.push({ key: step, label: step, state: 'active' });
  }

  return (
    <ol className="steps" aria-label="Этапы деплоя">
      {items.map((item) => (
        <li
          key={item.key}
          className="steps-item"
          data-state={item.state}
          data-tone={
            item.state === 'done'
              ? 'ok'
              : item.state === 'active'
                ? activeTone(status)
                : 'neutral'
          }
          title={item.key}
          aria-current={item.state === 'active' ? 'step' : undefined}
        >
          <span className="steps-icon">
            <StepIcon state={item.state} status={status} />
          </span>
          <span className="steps-label">{item.label}</span>
          <span className="visually-hidden">{stateText(item.state, status)}</span>
        </li>
      ))}
    </ol>
  );
}

import type { ReactNode } from 'react';
import { CircleCheck, Info, OctagonX, TriangleAlert } from 'lucide-react';
import './Callout.css';

export type CalloutTone = 'ok' | 'info' | 'warn' | 'danger';

const ICONS = {
  ok: CircleCheck,
  info: Info,
  warn: TriangleAlert,
  danger: OctagonX,
} as const;

interface CalloutProps {
  tone: CalloutTone;
  children: ReactNode;
  className?: string;
}

/**
 * Inline-результат операции на месте действия (design-system §2.12):
 * успех/429/424 не всплывают тостами. warn/danger объявляются role=alert.
 */
export function Callout({ tone, children, className }: CalloutProps) {
  const Icon = ICONS[tone];
  return (
    <div
      className={['callout', `callout-${tone}`, className].filter(Boolean).join(' ')}
      role={tone === 'warn' || tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={14} className="callout-icon" aria-hidden />
      <div className="callout-body">{children}</div>
    </div>
  );
}

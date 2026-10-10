import type { ReactNode } from 'react';
import './Chip.css';

export type ChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  title?: string;
}

export function Chip({ tone = 'neutral', children, title }: ChipProps) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      <span className="chip-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

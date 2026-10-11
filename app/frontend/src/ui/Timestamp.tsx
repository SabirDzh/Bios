import { formatDateTime, formatRelative } from '../lib/format';
import './Timestamp.css';

interface TimestampProps {
  iso: string | null | undefined;
  /** true — точное время («5 окт 2026, 14:20») вместо относительного. */
  absolute?: boolean;
  className?: string;
}

export function Timestamp({ iso, absolute = false, className }: TimestampProps) {
  const text = absolute ? formatDateTime(iso) : formatRelative(iso);
  return (
    <span
      className={['timestamp', text === '—' ? 'timestamp-missing' : undefined, className]
        .filter(Boolean)
        .join(' ')}
      title={formatDateTime(iso)}
    >
      {text}
    </span>
  );
}

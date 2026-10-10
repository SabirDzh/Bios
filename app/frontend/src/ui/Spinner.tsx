import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 16, label = 'Загрузка' }: SpinnerProps) {
  return (
    <Loader2
      className="spin"
      size={size}
      role="status"
      aria-label={label}
    />
  );
}

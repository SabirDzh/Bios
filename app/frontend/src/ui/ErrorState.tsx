import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from './Button';
import './ErrorState.css';

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = 'Не удалось загрузить данные',
  description,
  onRetry,
  retryLabel = 'Повторить',
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert className="error-state-icon" size={18} aria-hidden />
      <div className="error-state-body">
        <div className="error-state-title">{title}</div>
        {description && <div className="error-state-description">{description}</div>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

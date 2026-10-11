import { Button } from './Button';
import './LoadMore.css';

interface LoadMoreProps {
  onClick: () => void;
  loading?: boolean;
  exhausted?: boolean;
  label?: string;
}

export function LoadMore({
  onClick,
  loading,
  exhausted,
  label = 'Показать ещё',
}: LoadMoreProps) {
  if (exhausted) return null;
  return (
    <div className="load-more">
      <Button onClick={onClick} loading={loading}>
        {label}
      </Button>
    </div>
  );
}

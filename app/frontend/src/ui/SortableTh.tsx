import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import './Table.css';

interface SortableThProps {
  children: ReactNode;
  direction: 'asc' | 'desc' | null;
  onToggle: () => void;
  className?: string;
}

export function SortableTh({
  children,
  direction,
  onToggle,
  className,
}: SortableThProps) {
  const ariaSort =
    direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';

  return (
    <th aria-sort={ariaSort} className={['th-sort', className].filter(Boolean).join(' ')}>
      <button type="button" className="th-sort-btn" onClick={onToggle}>
        <span>{children}</span>
        {direction === 'asc' && <ChevronUp size={12} aria-hidden />}
        {direction === 'desc' && <ChevronDown size={12} aria-hidden />}
        {direction === null && (
          <ChevronsUpDown size={12} className="th-sort-idle" aria-hidden />
        )}
      </button>
    </th>
  );
}

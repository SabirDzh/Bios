import type { ReactNode } from 'react';
import './Table.css';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={['table-wrap', className].filter(Boolean).join(' ')}>
      <table className="table">{children}</table>
    </div>
  );
}

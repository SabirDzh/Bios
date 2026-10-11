import type { ReactNode } from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import type { BreadcrumbItem } from './Breadcrumbs';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  /** От 3 уровней вложенности; на списках верхнего уровня не нужны. */
  breadcrumbs?: BreadcrumbItem[];
  /** Строка мета под заголовком: счётчики, хост, статусы. */
  meta?: ReactNode;
  /** Действия справа; primary-действие — крайним справа. */
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumbs, meta, actions }: PageHeaderProps) {
  return (
    <div className="page-head">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} />
      )}
      <div className="page-head-row">
        <h1>{title}</h1>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {meta && <div className="page-head-meta">{meta}</div>}
    </div>
  );
}

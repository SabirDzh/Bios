import { Link } from 'react-router';
import './Breadcrumbs.css';

export interface BreadcrumbItem {
  label: string;
  /** Нет `to` — узел без ссылки (обычно последний: текущая страница). */
  to?: string;
}

/**
 * Хлебные крошки — иерархия, не история кликов. Показываются от 3 уровней
 * (правило IA); последний элемент — aria-current="page", не ссылка.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Хлебные крошки" className="breadcrumbs">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`}>
              {last || !item.to ? (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

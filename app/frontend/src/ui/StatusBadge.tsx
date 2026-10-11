import type { StatusMeta } from '../lib/statusMeta';
import './StatusBadge.css';

interface StatusBadgeProps {
  meta: StatusMeta;
  /**
   * Компактный вариант (карточки серверов): только глиф-иконка. Смысл статуса
   * остаётся полным: `role="img"` + aria-label и tooltip с подписью.
   */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Цвет + глиф + текст: цвет никогда не единственный носитель смысла.
 * Данные — из lib/statusMeta (словари бэкенда).
 */
export function StatusBadge({
  meta,
  iconOnly = false,
  className,
}: StatusBadgeProps) {
  const Icon = meta.icon;
  return (
    <span
      className={[
        'status-badge',
        `status-badge-${meta.tone}`,
        iconOnly ? 'status-badge-icon' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role={iconOnly ? 'img' : undefined}
      aria-label={iconOnly ? meta.label : undefined}
      title={iconOnly ? meta.label : meta.title}
    >
      <Icon size={iconOnly ? 13 : 12} className={meta.spin ? 'spin' : undefined} aria-hidden />
      {!iconOnly && meta.label}
    </span>
  );
}

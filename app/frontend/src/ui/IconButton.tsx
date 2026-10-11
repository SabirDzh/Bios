import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './IconButton.css';

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Доступное имя; попадает в aria-label и (по умолчанию) в title. */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'default';
  size?: 'md' | 'sm';
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  title,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={['icon-btn', `icon-btn-${variant}`, `icon-btn-${size}`, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
    </button>
  );
}

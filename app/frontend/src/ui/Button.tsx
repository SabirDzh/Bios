import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import './Button.css';

type Variant = 'primary' | 'default' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, `btn-${size}`, className]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className="spin" size={size === 'sm' ? 12 : 14} aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

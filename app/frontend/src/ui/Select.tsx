import { useId } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import './TextField.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Select({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={selectId}>
        {label}
      </label>
      <div className="field-select-wrap">
        <select
          id={selectId}
          className={
            error
              ? 'field-input field-select field-input-error'
              : 'field-input field-select'
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="field-select-caret" size={14} aria-hidden />
      </div>
      {hint && !error && (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

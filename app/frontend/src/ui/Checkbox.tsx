import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import './Checkbox.css';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Checkbox({ label, hint, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={['checkbox', className].filter(Boolean).join(' ')}>
      <input
        id={inputId}
        type="checkbox"
        className="checkbox-input"
        aria-describedby={hintId}
        {...rest}
      />
      <div className="checkbox-body">
        <label className="checkbox-label" htmlFor={inputId}>
          {label}
        </label>
        {hint && (
          <div className="checkbox-hint" id={hintId}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

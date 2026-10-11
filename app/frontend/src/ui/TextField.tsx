import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import './TextField.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Подпись над полем. Можно опустить (тогда нужен aria-label): страницы
      auth показывают только плейсхолдеры. */
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  /** Кнопка/иконка внутри поля справа (глазок пароля и т.п.). */
  trailing?: ReactNode;
}

export function TextField({
  label,
  hint,
  error,
  trailing,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div
        className={['field-control', trailing ? 'has-trailing' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <input
          id={inputId}
          className={error ? 'field-input field-input-error' : 'field-input'}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
        {trailing}
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

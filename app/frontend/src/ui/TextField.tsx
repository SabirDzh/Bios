import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import './TextField.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Подпись над полем. Можно опустить (тогда нужен aria-label): страницы
      auth показывают только плейсхолдеры. */
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  /** Иконка у левого края поля (поиск и т.п.); класс `.field-leading`. */
  leading?: ReactNode;
  /** Кнопка/иконка внутри поля справа (глазок пароля и т.п.). */
  trailing?: ReactNode;
  /** React 19: ref — обычный prop, уходит на DOM-input (фокус из страницы). */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  leading,
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
        className={[
          'field-control',
          leading ? 'has-leading' : '',
          trailing ? 'has-trailing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {leading}
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

import { useId } from 'react';
import type { ReactNode, TextareaHTMLAttributes } from 'react';
import './TextField.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Техническое содержимое (ключи, конфиги) — моноширинный шрифт. */
  mono?: boolean;
}

export function Textarea({
  label,
  hint,
  error,
  mono = false,
  id,
  className,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const hintId = hint ? `${areaId}-hint` : undefined;
  const errorId = error ? `${areaId}-error` : undefined;

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={areaId}>
        {label}
      </label>
      <textarea
        id={areaId}
        className={[
          'field-input',
          'field-textarea',
          mono ? 'field-mono' : undefined,
          error ? 'field-input-error' : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
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

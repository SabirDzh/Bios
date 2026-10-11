import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TextField } from '../../ui/TextField';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  /** Accessible name: без видимого лейбла обязателен. */
  ariaLabel: string;
}

export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  ariaLabel,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      type={visible ? 'text' : 'password'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete={autoComplete}
      required={required}
      trailing={
        <button
          type="button"
          className="field-eye"
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={visible}
          title={visible ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? (
            <EyeOff size={18} aria-hidden />
          ) : (
            <Eye size={18} aria-hidden />
          )}
        </button>
      }
    />
  );
}

import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import './Toolbar.css';

interface ToolbarProps {
  /** Левая часть: счётчики, подписи. Фильтры появятся с серверной поддержкой. */
  children?: ReactNode;
  /** Правая часть: действия (ghost-кнопки, refresh). */
  actions?: ReactNode;
  /** Фоновое обновление: контент не исчезает, спиннер живёт здесь. */
  busy?: boolean;
}

export function Toolbar({ children, actions, busy = false }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {children}
        {busy && <Spinner size={12} label="Обновление" />}
      </div>
      {actions && <div className="toolbar-actions">{actions}</div>}
    </div>
  );
}

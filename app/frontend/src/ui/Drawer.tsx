import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import './Drawer.css';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок панели; может содержать значок, поэтому доступное имя отдельное. */
  title: ReactNode;
  /** Доступное имя диалога (aria-label). */
  ariaLabel: string;
  children: ReactNode;
  /** Нижняя панель действий; кнопки растягиваются на её ширину. */
  footer?: ReactNode;
}

/**
 * Шторка справа: тот же нативный <dialog>, что у Modal, но выровнен по правому
 * краю во всю высоту. Esc, клик по подложке и «Закрыть» зовут onClose; фокус-трап
 * и возврат фокуса — нативные.
 */
export function Drawer({ open, onClose, title, ariaLabel, children, footer }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Явный фокус: в jsdom showModal не перемещает фокус сам, а в браузере
      // делает это недетерминированно (первый focusable внутри dialog).
      closeRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Пуш-режим: пока шторка открыта, оболочка отдаёт её ширину справа
  // (Shell.css: :root[data-drawer='open'] .shell).
  useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.drawer = 'open';
    return () => {
      delete document.documentElement.dataset.drawer;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={ariaLabel}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-head">
          <h2 className="drawer-title">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

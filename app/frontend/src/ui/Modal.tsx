import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Широкая панель: мастера с полями в строку (сервер: хост + порт, ключ). */
  wide?: boolean;
  /**
   * false — модалка закрывается только явным действием внутри (кнопка):
   * крестик не рисуется, клик по подложке и Esc не закрывают. Для форм, где
   * случайное закрытие стоит введённых данных.
   */
  dismissable?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  dismissable = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'modal modal-wide' : 'modal'}
      aria-label={title}
      onClose={onClose}
      onCancel={
        dismissable
          ? undefined
          : (event) => {
              event.preventDefault();
            }
      }
      onClick={(event) => {
        if (dismissable && event.target === ref.current) onClose();
      }}
    >
      <div className="modal-panel">
        <div className="modal-head">
          <h2>{title}</h2>
          {dismissable && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Закрыть"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

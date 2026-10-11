import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Последствие операции; имя ресурса передаётся mono-элементом. */
  description?: ReactNode;
  confirmLabel: string;
  /**
   * danger (по умолчанию) — разрушительное; primary — необратимое,
   * но не разрушительное (например, TOFU-доверие отпечатку).
   */
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="confirm-text">{description}</div>}
    </Modal>
  );
}

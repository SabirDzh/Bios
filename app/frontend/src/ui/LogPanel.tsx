import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/format';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import './LogPanel.css';

export interface LogPanelProps {
  /** Текст журнала; null/undefined — ещё не загружен. */
  log: string | null | undefined;
  /** Размер журнала из API — в шапке панели. */
  sizeBytes?: number | null;
  /** Задача завершена: пауза не нужна, остаётся ручное обновление. */
  finished: boolean;
  /** Пауза автообновления (до завершения задачи). */
  paused?: boolean;
  onTogglePause?: () => void;
  onRefresh?: () => void;
  /** Идёт запрос — спиннер на «Обновить». */
  refreshing?: boolean;
  className?: string;
}

/** Ниже этого зазора считаем, что пользователь «у низа» и ведём скролл за текстом. */
const STICK_THRESHOLD_PX = 24;

/**
 * Журнал исполнения: mono-вывод на --bg-inset, прилипание к низу, пауза и
 * перенос строк. Автоскролл выключается, когда пользователь отлистал вверх —
 * иначе новый вывод выдёргивал бы его обратно.
 */
export function LogPanel({
  log,
  sizeBytes,
  finished,
  paused = false,
  onTogglePause,
  onRefresh,
  refreshing = false,
  className,
}: LogPanelProps) {
  const scrollerRef = useRef<HTMLPreElement>(null);
  const [stick, setStick] = useState(true);
  const [wrap, setWrap] = useState(false);

  const text = log ?? '';

  useEffect(() => {
    if (!stick) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, stick]);

  function handleScroll(): void {
    const el = scrollerRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX);
  }

  function jumpToBottom(): void {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStick(true);
  }

  return (
    <section
      className={['log-panel', className].filter(Boolean).join(' ')}
      aria-label="Журнал деплоя"
    >
      <header className="log-head">
        <h2 className="log-title">Журнал</h2>
        {sizeBytes != null && (
          <span className="log-size mono">{formatBytes(sizeBytes)}</span>
        )}
        <div className="log-actions">
          {!finished && onTogglePause && (
            <Button size="sm" onClick={onTogglePause}>
              {paused ? 'Продолжить' : 'Пауза'}
            </Button>
          )}
          {(finished || paused) && onRefresh && (
            <Button size="sm" loading={refreshing} onClick={onRefresh}>
              Обновить
            </Button>
          )}
          {!stick && (
            <Button size="sm" variant="ghost" onClick={jumpToBottom}>
              К низу
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={wrap}
            title="Переносить длинные строки"
            onClick={() => setWrap((value) => !value)}
          >
            Перенос
          </Button>
          {text !== '' && <CopyButton value={text} label="Копировать" />}
        </div>
      </header>
      {text !== '' ? (
        <pre
          ref={scrollerRef}
          className={wrap ? 'log-body log-wrap' : 'log-body'}
          onScroll={handleScroll}
        >
          {text}
        </pre>
      ) : (
        <div className="log-empty">Пока пусто</div>
      )}
    </section>
  );
}

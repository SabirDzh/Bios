import { osMeta } from '../lib/osMeta';
import './OsIcon.css';

/**
 * Бейдж ОС для карточки сервера: буква семейства, тон — в data-os (OsIcon.css).
 * Подсказка и доступное имя — исходная строка ОС целиком (правило «не подменяем»).
 */
export function OsIcon({ osName }: { osName: string | null }) {
  const meta = osMeta(osName);
  const title = osName ?? 'ОС не определена';
  return (
    <span
      className="os-icon"
      data-os={meta?.key ?? 'unknown'}
      role="img"
      aria-label={title}
      title={title}
    >
      {meta?.abbr ?? '?'}
    </span>
  );
}

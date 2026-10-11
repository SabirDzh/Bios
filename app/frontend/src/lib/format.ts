const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
}

/** Относительное время для списков: «3 мин назад». Старше недели — дата. */
export function formatRelative(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (sec < 45) return 'только что';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return formatDate(iso);
}

/** Русская форма множественного числа: plural(2) → few («2 сервера»). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

/**
 * Длительность деплоя. До 10 с — десятые («3.4 с»), дальше округление:
 * десятая доля у 42-секундной сборки — шум, а не точность.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  const sec = ms / 1000;
  if (sec < 60) return sec < 10 ? `${sec.toFixed(1)} с` : `${Math.round(sec)} с`;
  const totalMin = Math.floor(sec / 60);
  if (totalMin < 60) {
    const restSec = Math.floor(sec % 60);
    return restSec > 0 ? `${totalMin} мин ${restSec} с` : `${totalMin} мин`;
  }
  const hours = Math.floor(sec / 3600);
  const restMin = Math.floor((sec % 3600) / 60);
  return restMin > 0 ? `${hours} ч ${restMin} мин` : `${hours} ч`;
}

/** Размер журнала: «512 Б», «1.5 КБ», «2.3 МБ». */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return kb < 10 ? `${kb.toFixed(1)} КБ` : `${Math.round(kb)} КБ`;
  const mb = kb / 1024;
  return mb < 10 ? `${mb.toFixed(1)} МБ` : `${Math.round(mb)} МБ`;
}

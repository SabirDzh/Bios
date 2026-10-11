/**
 * Опознание ОС хоста по SSH. Основной источник — hostnamectl (точное
 * человекочитаемое имя дистрибутива), фолбэк — uname -a: систем без systemd
 * hostnamectl не существует вовсе, а на очень старых ОС его вывод бесполезен.
 * «Установить systemd» на чужой сервер панель не может и не должна — вопрос
 * решается выбором источника, а не изменением хоста.
 */

export const OS_NAME_MAX = 64;

/** hostnamectl без systemd отвечает ошибкой в stderr — глушим её, решает парсер. */
export function buildOsProbeCommand(): string {
  return 'hostnamectl 2>/dev/null; uname -a';
}

// Метка в выводе hostnamectl выровнена вправо (ведущие пробелы); [ \t]* — не \s*:
// \s перепрыгивает через \n и тащит в захват следующую строку.
const HOSTNAMECTL_OS_RE = /^[ \t]*Operating System:[ \t]*(.+)$/m;

/** `Linux host 5.15.0-91-generic #101-Ubuntu SMP ... x86_64 x86_64 x86_64 GNU/Linux` */
const UNAME_RE = /^Linux\s+\S+\s+(\S+)\s+.*?\s(\S+)\s+GNU\/Linux\s*$/m;

export function parseOsName(stdout: string): string | null {
  const pretty = HOSTNAMECTL_OS_RE.exec(stdout)?.[1];
  if (pretty !== undefined) {
    const clean = sanitize(pretty);
    // Строка hostnamectl есть, но пуста/битая — fallback не отменяется.
    if (clean !== null) return clean;
  }

  const uname = UNAME_RE.exec(stdout);
  if (uname) return sanitize(`Linux ${uname[1]} (${uname[2]})`);
  return null;
}

/** Управляющие символы и переводы строк в БД и UI не нужны; длина — под бейдж. */
function sanitize(raw: string): string | null {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean === '') return null;
  return clean.slice(0, OS_NAME_MAX);
}

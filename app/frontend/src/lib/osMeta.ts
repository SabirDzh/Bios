/**
 * Семейство ОС по строке из пробы (hostnamectl → uname). Значение приходит с
 * удалённого хоста, поэтому строки никогда не подменяются «красивыми»: label
 * для неизвестных семейств — исходный текст. Цвет бейджа — в OsIcon.css.
 */
export interface OsMeta {
  /** Ключ семейства — уходит в data-os для цвета бейджа. */
  key: string;
  /** Аббревиатура бейджа (1 знак). */
  abbr: string;
  /** Человекочитаемое имя семейства. */
  label: string;
}

interface FamilyRule extends OsMeta {
  match: RegExp;
}

// Порядок важен: «Ubuntu» проверяется раньше общего «Linux» из фолбэка uname.
const FAMILIES: FamilyRule[] = [
  { key: 'ubuntu', abbr: 'U', label: 'Ubuntu', match: /^ubuntu/i },
  { key: 'debian', abbr: 'D', label: 'Debian', match: /^debian/i },
  { key: 'kali', abbr: 'K', label: 'Kali', match: /^kali/i },
  { key: 'rhel', abbr: 'R', label: 'RHEL', match: /^(red hat|rhel)/i },
  { key: 'centos', abbr: 'C', label: 'CentOS', match: /^centos/i },
  { key: 'fedora', abbr: 'F', label: 'Fedora', match: /^fedora/i },
  { key: 'rocky', abbr: 'R', label: 'Rocky Linux', match: /^rocky/i },
  { key: 'alma', abbr: 'A', label: 'AlmaLinux', match: /^alma/i },
  { key: 'suse', abbr: 'S', label: 'SUSE', match: /^(opensuse|suse|sles)/i },
  { key: 'arch', abbr: 'A', label: 'Arch Linux', match: /^arch/i },
  { key: 'manjaro', abbr: 'M', label: 'Manjaro', match: /^manjaro/i },
  { key: 'alpine', abbr: 'A', label: 'Alpine', match: /^alpine/i },
  { key: 'gentoo', abbr: 'G', label: 'Gentoo', match: /^gentoo/i },
  { key: 'linux', abbr: 'L', label: 'Linux', match: /^linux/i },
];

/**
 * null — ОС ещё не опознана (хост не проверяли). Непустая незнакомая строка
 * даёт семейство other: буква из самой строки, подпись — как есть.
 */
export function osMeta(osName: string | null | undefined): OsMeta | null {
  const trimmed = osName?.trim();
  if (!trimmed) return null;
  for (const rule of FAMILIES) {
    if (rule.match.test(trimmed)) {
      return { key: rule.key, abbr: rule.abbr, label: rule.label };
    }
  }
  return { key: 'other', abbr: trimmed[0].toUpperCase(), label: trimmed };
}

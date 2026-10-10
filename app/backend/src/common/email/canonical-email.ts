/**
 * Канонизация email для дедупликации аккаунтов.
 *
 * Проблема: проверки смотрят только на домен, а Gmail/Outlook позволяют
 * бесконечные алиасы одного ящика (`a.b+spam@gmail.com` === `ab@gmail.com`).
 * Канон считается детерминированно и хранится в `User.canonicalEmail @unique` —
 * дубль упирается в базу, гонки исключены.
 *
 * Правила (зеркалятся в SQL-бэкфилле миграции `user_canonical_email`):
 * - gmail.com / googlemail.com: точки из локальной части вырезать, `+тег`
 *   отрезать, домен googlemail.com схлопнуть в gmail.com (один ящик);
 * - outlook.com / hotmail.com / live.com / msn.com: отрезать `+тег`
 *   (точки там значимы, не трогаем);
 * - остальные домены: только trim + lowercase.
 *
 * Вырожденные входы (нет `@`, пустая локальная часть после канонизации)
 * возвращаются как trim+lowercase без изменений.
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const PLUS_TAG_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
]);

export function canonicalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return normalized;
  const rawLocal = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    const local = rawLocal.split('+', 1)[0].replace(/\./g, '');
    if (!local) return normalized;
    domain = 'gmail.com';
    return `${local}@${domain}`;
  }
  if (PLUS_TAG_DOMAINS.has(domain)) {
    const local = rawLocal.split('+', 1)[0];
    if (!local) return normalized;
    return `${local}@${domain}`;
  }
  return normalized;
}

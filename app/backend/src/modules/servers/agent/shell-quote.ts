/** POSIX-экранирование одного аргумента: одинарная кавычка закрывается, экранируется, открывается. */
export function shq(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Непривилегированный пользователь получает каждый опасный шаг через sudo -n. */
export function priv(command: string, root: boolean): string {
  return root ? command : `sudo -n sh -lc ${shq(command)}`;
}

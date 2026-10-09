import type { SshErrorCode } from './ssh-runner';

/**
 * Транспортный сбой SSH → код для API. Порядок проверок значим: «reset» не должен
 * превращаться в «timeout» (замечание ревью №11), а незнакомая форма — в ложную
 * конкретную причину.
 */
export function classifySshError(err: unknown): SshErrorCode {
  const e = err as (Error & { code?: string; name?: string }) | undefined;
  const fallback = typeof err === 'string' ? err : '';
  const text =
    `${e?.code ?? ''} ${e?.name ?? ''} ${e?.message ?? fallback}`.toLowerCase();

  if (text.includes('all configured authentication methods failed')) {
    return 'AUTH_FAILED';
  }
  if (text.includes('host key') || text.includes('handshake failed')) {
    return 'HOST_KEY';
  }
  if (text.includes('econnrefused')) return 'REFUSED';
  if (
    text.includes('enotfound') ||
    text.includes('eai_again') ||
    text.includes('getaddrinfo')
  ) {
    return 'DNS';
  }
  if (
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('timeout')
  ) {
    return 'TIMEOUT';
  }
  // ECONNRESET / «reset by peer» / неизвестное — это разрыв, а не истечение срока.
  return 'NETWORK';
}

import type { SshErrorCode } from '../ssh/ssh-runner';

/**
 * `docker system dial-stdio` — единственная команда модуля, и её stderr есть
 * диагноз «Docker недоступен». Тот же набор признаков, что у
 * `classifyDockerFailure` в части 3, но вход — текст канала и код его выхода,
 * а не результат отдельного exec: отдельного раунд-трипа на проверку мы не делаем.
 */
export function classifyDialFailure(
  stderr: string,
  observed: string,
): SshErrorCode {
  const text = `${stderr} ${observed}`.toLowerCase();
  if (
    text.includes('command not found') ||
    text.includes('docker: not found')
  ) {
    return 'DOCKER_MISSING';
  }
  if (text.includes('permission denied')) return 'DOCKER_PERMISSION_DENIED';
  if (text.includes('cannot connect to the docker daemon')) {
    return 'DOCKER_SOCKET_UNREACHABLE';
  }
  return 'DOCKER_UNREACHABLE';
}

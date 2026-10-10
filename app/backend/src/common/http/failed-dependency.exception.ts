import { HttpException } from '@nestjs/common';
import type { SshErrorCode } from '../../modules/servers/ssh/ssh-runner';

/**
 * HTTP 424 Failed Dependency: удалённый хост или агент не в порядке, а запрос
 * клиента — нет. В Nest готового класса нет, а контракт модуля требует тело
 * `{ statusCode, errorCode, message }`, поэтому фиксируем форму здесь.
 */
export class FailedDependencyException extends HttpException {
  constructor(details: { errorCode: SshErrorCode; message: string }) {
    super(
      {
        statusCode: 424,
        errorCode: details.errorCode,
        message: details.message,
      },
      424,
    );
  }
}

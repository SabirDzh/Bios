import { HttpException } from '@nestjs/common';

/**
 * HTTP 424 Failed Dependency: удалённая зависимость (SSH-хост, агент, движок
 * поиска) не в порядке, а запрос клиента — нет. В Nest готового класса нет,
 * а контракт модуля требует тело `{ statusCode, errorCode, message }`,
 * поэтому фиксируем форму здесь. Код — строка из словаря домена (SshErrorCode,
 * DeployErrorCode, SEARCH_UNAVAILABLE, …): он маппится в текст на клиенте.
 */
export class FailedDependencyException extends HttpException {
  constructor(details: { errorCode: string; message: string }) {
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

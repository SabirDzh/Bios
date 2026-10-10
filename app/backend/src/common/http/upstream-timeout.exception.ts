import { HttpException } from '@nestjs/common';

/**
 * HTTP 504: ждали удалённый ответ дольше дедлайна. Отдельный класс, а не
 * «424 с кодом TIMEOUT», потому что это разные диагностика и реакция: зависший
 * демон — временное состояние, недоступный — устойчивое. Тело сохраняет
 * контракт конверта `{ statusCode, errorCode, message }`.
 */
export class UpstreamTimeoutException extends HttpException {
  constructor(message: string) {
    super({ statusCode: 504, errorCode: 'TIMEOUT', message }, 504);
  }
}

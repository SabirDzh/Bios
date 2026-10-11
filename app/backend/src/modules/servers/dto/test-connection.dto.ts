import { IsOptional, Matches } from 'class-validator';
import { ConnectionFieldsDto } from './connection-fields.dto';

/** Тело POST .../servers/test-connection: проверка соединения без сохранения. */
export class TestConnectionDto extends ConnectionFieldsDto {
  /** Подтверждение отпечатка: клиент обязан прислать ровно то, что вернул предыдущий test-connection. */
  @IsOptional()
  @Matches(/^SHA256:[A-Za-z0-9+/]{43}={0,2}$/, {
    message: 'trustHostKey must be a SHA256:<base64> host key fingerprint',
  })
  trustHostKey?: string;
}

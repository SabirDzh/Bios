import { IsOptional, Matches } from 'class-validator';

/** Подтверждение отпечатка: клиент обязан прислать ровно то, что вернул предыдущий test. */
export class TestServerDto {
  @IsOptional()
  @Matches(/^SHA256:[A-Za-z0-9+/]{43}={0,2}$/, {
    message: 'trustHostKey must be a SHA256:<base64> host key fingerprint',
  })
  trustHostKey?: string;
}

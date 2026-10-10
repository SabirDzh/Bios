import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ServerAuthType } from '@prisma/client';
import { CredentialMatchesAuthType } from '../../../common/validators/credential-matches-auth-type.validator';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const ValidateIfPassword = () =>
  ValidateIf((o: CreateServerDto) => o.authType === ServerAuthType.PASSWORD);
const ValidateIfKey = () =>
  ValidateIf((o: CreateServerDto) => o.authType === ServerAuthType.KEY);

export class CreateServerDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  /** Только hostname или IPv4: без пробелов, без shell-метасимволов, без IPv6. */
  @Transform(lower)
  @IsString()
  @MaxLength(253)
  @Matches(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/, {
    message:
      'host must be a hostname or IPv4 literal without spaces or shell metacharacters',
  })
  host: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value.trim())
      ? parseInt(value.trim(), 10)
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number = 22;

  @Transform(lower)
  @IsString()
  @Matches(/^[a-z_][a-z0-9_-]{0,31}$/, {
    message: 'sshUsername must be a POSIX user name',
  })
  sshUsername: string;

  @IsIn([ServerAuthType.PASSWORD, ServerAuthType.KEY], {
    message: `authType must be one of the following values: ${ServerAuthType.PASSWORD}, ${ServerAuthType.KEY}`,
  })
  @CredentialMatchesAuthType()
  authType: ServerAuthType;

  @ValidateIfPassword()
  @IsString()
  @Length(8, 512)
  sshPassword?: string;

  /**
   * Грубый фильтр формы, не валидация ключа: структуру и факт шифрования
   * отвергает сервис на create (Task 8, ssh2 `utils.parseKey`).
   */
  @ValidateIfKey()
  @IsString()
  @Matches(
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    { message: 'sshPrivateKey must be a PEM private key' },
  )
  @Length(32, 16384)
  sshPrivateKey?: string;
}

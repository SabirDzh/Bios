import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { ConnectionFieldsDto } from './connection-fields.dto';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateServerDto extends ConnectionFieldsDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  /**
   * Отпечаток, подтверждённый в мастере создания (TOFU на шаге
   * test-connection): сохраняется сразу, чтобы первый test из списка не
   * требовал подтверждения заново.
   */
  @IsOptional()
  @Matches(/^SHA256:[A-Za-z0-9+/]{43}={0,2}$/, {
    message:
      'hostKeyFingerprint must be a SHA256:<base64> host key fingerprint',
  })
  hostKeyFingerprint?: string;
}

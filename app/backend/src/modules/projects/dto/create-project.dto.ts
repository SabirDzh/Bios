import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  /** Форму проверяет regex; нормализацию и адресные запреты — сервис. */
  @Transform(trim)
  @IsString()
  @Length(8, 500)
  repoUrl: string;
}

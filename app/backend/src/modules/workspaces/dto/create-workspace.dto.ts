import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';

export class CreateWorkspaceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;
}

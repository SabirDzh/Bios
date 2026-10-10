import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import {
  DISPLAY_NAME_MESSAGE,
  DISPLAY_NAME_PATTERN,
} from '../../../common/validators/display-name.validator';
import {
  CONTAINER_NAME_RE,
  GIT_REF_RE,
  RELATIVE_FILE_RE,
} from '../project.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Единственный исполняемый метод среза 1. */
export const SUPPORTED_METHODS = ['GIT_PULL'] as const;

export class CreateDeployConfigDto {
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(DISPLAY_NAME_PATTERN, { message: DISPLAY_NAME_MESSAGE })
  name: string;

  @IsIn(SUPPORTED_METHODS, {
    message:
      'method must be GIT_PULL (compose, shell script и custom commands — следующий срез)',
  })
  method: 'GIT_PULL';

  @Transform(trim)
  @IsString()
  @Matches(GIT_REF_RE, { message: 'ref must be a plain branch or tag name' })
  ref: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(RELATIVE_FILE_RE, {
    message: 'dockerfile must be a relative path inside the repository',
  })
  dockerfile?: string;

  @Transform(trim)
  @IsString()
  @Matches(CONTAINER_NAME_RE, {
    message: 'containerName must be a docker container name',
  })
  containerName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ports?: string[];

  /** UUIDv7 сервера того же воркспейса; чужой serverId → 404 в сервисе. */
  @IsUUID('7')
  serverId: string;
}

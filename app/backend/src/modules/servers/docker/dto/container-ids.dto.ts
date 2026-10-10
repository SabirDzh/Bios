import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ServerIdsDto } from '../../dto/server-ids.dto';

/**
 * Docker принимает либо id (hex), либо ИМЯ контейнера, и имя уходит в путь
 * Docker API. Whitelist жёсткий: первый символ — буква/цифра, дальше `[-_.]`,
 * длина ≤ 128. Это отсекает и `/`, и `%2f`, и `..`-апгрейд пути внутри вызова.
 */
export const CONTAINER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** workspaceId и serverId наследуют @IsUUID('7') (dto/server-ids.dto.ts:3-9). */
export class ContainerIdsDto extends ServerIdsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(CONTAINER_ID_RE, {
    message: 'containerId must be a docker container id or name',
  })
  containerId!: string;
}

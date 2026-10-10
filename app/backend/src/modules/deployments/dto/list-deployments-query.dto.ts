import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * `limit` — строка с цифрами, а не число: `@Query()` приходит из URL строкой, а
 * приведение через `@Type` превратило бы `?limit=abc` в NaN и 500 вместо 400.
 * Тот же приём, что в `docker/dto/containers-query.dto.ts`.
 * Диапазон 1–100 держит именно regex: `/^\d{1,3}$/` пропускал `000`, и `take: 0`
 * давал пустой список с сообщением, что разрешены значения от 1.
 */
export class ListDeploymentsQueryDto {
  @IsOptional()
  @IsUUID('7')
  projectId?: string;

  @IsOptional()
  @IsUUID('7')
  configId?: string;

  @IsOptional()
  @Matches(/^(?:[1-9]\d?|100)$/, {
    message: 'limit must be an integer between 1 and 100',
  })
  limit?: string;
}

import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * `tail` режет историю НА СТОРОНЕ демона (10000 строк — потолок, который мы
 * разрешаем); бюджет панели режет по байтам и `tail` не принимает.
 */
export const LOGS_DEFAULT_TAIL = 200;

export class ContainerLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  tail?: number = LOGS_DEFAULT_TAIL;

  @IsOptional()
  @IsBooleanString()
  timestamps?: string;

  /** Unix-секунды: только строки позже этой отметки. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;
}

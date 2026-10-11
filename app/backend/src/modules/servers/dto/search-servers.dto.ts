import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Размер выдачи поиска по умолчанию: движок ранжирует и режет по limit,
 * панель не листает результаты — их принимает решение «искать точнее».
 */
export const SEARCH_LIMIT_DEFAULT = 50;

/** Поиск серверов: q — непустой запрос после trim, limit — размер выдачи. */
export class SearchServersDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

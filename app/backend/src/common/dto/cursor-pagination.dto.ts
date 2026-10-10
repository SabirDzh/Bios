import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Курсорная пагинация (keyset) для list-эндпоинтов.
 *
 * Почему не готовый offset-`PaginationDto` (`page/limit`): offset дрейфует
 * при конкурентных вставках (дубли/пропуски) и стоит O(offset). Курсор —
 * непрозрачный `base64url({ts, id})`, where-клауза keyset `(ts, id) > cursor`
 * при `orderBy [field asc, id asc]` даёт стабильный обход без дублей.
 * id в паре обязателен: ts (`joinedAt`/`createdAt`, точность — мс) не уникален.
 */
export class CursorPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export interface CursorPage<T> {
  items: T[];
  /** null — последняя страница. */
  nextCursor: string | null;
}

export interface DecodedCursor {
  ts: string;
  id: string;
}

export function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ ts: ts.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

/** Мусор в cursor — 400, а не 500 и не молчаливый игнор (fail-fast). */
export function decodeCursorOrThrow(cursor: string): DecodedCursor {
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (typeof raw !== 'object' || raw === null) throw new Error('shape');
    const { ts, id } = raw as { ts?: unknown; id?: unknown };
    if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) {
      throw new Error('ts');
    }
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
      throw new Error('id');
    }
    return { ts, id };
  } catch {
    throw new BadRequestException('invalid cursor');
  }
}

/**
 * Нарезка take+1 выборки в страницу. cursorOf строится по сырой строке
 * ДО маппинга в response (метке времени нет в ответе — она только в курсоре).
 */
export function takePage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor:
      hasMore && items.length > 0 ? cursorOf(items[items.length - 1]) : null,
  };
}

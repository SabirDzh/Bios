import { IsIn, IsOptional } from 'class-validator';

/**
 * `?all=` — единственный параметр списка. Строгая whitelist-проверка: `all=1`
 * или `all=yes` должны быть 400, а не молчаливым false.
 */
export class ContainersQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  all?: 'true' | 'false';
}

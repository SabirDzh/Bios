import { IsIn } from 'class-validator';

/**
 * Часть 4 умеет только restart. `recreate` из mvp-scope сюда не входит: он
 * требует останов→переопределение→старт и ломает «упавший контейнер виден без
 * SSH» как метрику. Узкий enum — явный сигнал следующему изменению, а не
 * заглушка.
 */
export class ContainerActionDto {
  @IsIn(['restart'])
  action!: 'restart';
}

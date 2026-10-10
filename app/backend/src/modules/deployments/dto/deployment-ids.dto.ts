import { IsUUID } from 'class-validator';

/** Плоский маршрут `deployments/:deploymentId` — воркспейса в пути нет. */
export class DeploymentIdsDto {
  @IsUUID('7')
  deploymentId: string;
}

import { IsUUID } from 'class-validator';

/**
 * `workspaceId` в теле нет и быть не может: область видимости берётся только из
 * пути, иначе запрос мог бы задеплоить в чужой воркспейс «по просьбе» тела.
 */
export class CreateDeploymentDto {
  @IsUUID('7')
  projectId: string;

  @IsUUID('7')
  configId: string;
}

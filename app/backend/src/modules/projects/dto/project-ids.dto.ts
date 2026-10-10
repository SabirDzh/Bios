import { IsUUID } from 'class-validator';

/** `workspaceId`/`projectId` — тот же uuid(7), что у остальных параметрических DTO. */
export class ProjectIdsDto {
  @IsUUID('7')
  workspaceId: string;

  @IsUUID('7')
  projectId: string;
}

import { IsUUID } from 'class-validator';

export class WorkspaceIdDto {
  @IsUUID('7')
  workspaceId: string;
}

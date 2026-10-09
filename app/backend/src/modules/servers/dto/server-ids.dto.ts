import { IsUUID } from 'class-validator';

export class ServerIdsDto {
  @IsUUID('7')
  workspaceId: string;

  @IsUUID('7')
  serverId: string;
}

import { IsUUID } from 'class-validator';

export class FindRecoveryByIdDto {
  @IsUUID('7')
  recoveryId: string;
}

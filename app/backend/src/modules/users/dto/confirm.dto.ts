import { IsUUID } from 'class-validator';

export class ConfirmDto {
  @IsUUID('7')
  confirmationId: string;
}

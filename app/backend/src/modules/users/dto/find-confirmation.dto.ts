import { IsUUID } from 'class-validator';

export class FindConfirmationByIdDto {
  @IsUUID('7')
  confirmationId: string;
}

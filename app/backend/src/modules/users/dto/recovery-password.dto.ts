import {
  IsString,
  IsNotEmpty,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class RecoveryPasswordDto {
  @IsUUID('7')
  recoveryId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^\S+$/, { message: 'password must not contain spaces' })
  password: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^\S+$/, { message: 'password must not contain spaces' })
  confirmPassword: string;
}

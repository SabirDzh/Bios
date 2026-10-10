import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AuthLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(254)
  @Matches(/^\S+@\S+\.\S+$/, {
    message: 'email must contain @ and .',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^\S+$/, { message: 'password must not contain spaces' })
  password: string;
}

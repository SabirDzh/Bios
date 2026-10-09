import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RequestRecoveryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(254)
  @Matches(/^\S+@\S+\.\S+$/, {
    message: 'email must contain @ and .',
  })
  email: string;
}

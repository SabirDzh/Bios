import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWorkspaceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 64)
  name: string;
}

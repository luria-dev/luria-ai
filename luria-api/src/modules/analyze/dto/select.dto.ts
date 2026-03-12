import { IsOptional, IsString } from 'class-validator';

export class SelectDto {
  @IsString()
  request_id!: string;

  @IsString()
  candidate_id!: string;

  @IsOptional()
  @IsString()
  target_key?: string;
}

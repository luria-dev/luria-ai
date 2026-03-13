import { IsIn, IsOptional, IsString } from 'class-validator';

export class BootstrapDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsIn(['24h', '7d'])
  time_window?: '24h' | '7d';

  @IsOptional()
  @IsString()
  preferred_chain?: string;

  @IsOptional()
  @IsString()
  thread_id?: string;
}

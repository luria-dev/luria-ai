import { IsIn, IsOptional, IsString } from 'class-validator';

export class AnalyzeDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  thread_id?: string;

  @IsOptional()
  @IsString()
  request_id?: string;

  @IsOptional()
  @IsIn(['24h', '7d'])
  time_window?: '24h' | '7d';

  @IsOptional()
  @IsString()
  preferred_chain?: string;
}

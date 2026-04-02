import { IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class AnalyzeDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(['instant', 'deep'])
  @Transform(({ value }) => value || undefined)
  mode?: 'instant' | 'deep';

  @IsOptional()
  @IsIn(['cn', 'en'])
  @Transform(({ value }) => value || undefined)
  lang?: 'cn' | 'en';

  @IsOptional()
  @IsString()
  thread_id?: string;

  @IsOptional()
  @IsString()
  request_id?: string;

  @IsOptional()
  @IsIn(['24h', '7d', '30d', '60d'])
  time_window?: '24h' | '7d' | '30d' | '60d';

  @IsOptional()
  @IsString()
  preferred_chain?: string;
}

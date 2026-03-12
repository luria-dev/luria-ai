import { Module } from '@nestjs/common';
import { AnalyzeController } from './analyze.controller';
import { OrchestrationModule } from '../../core/orchestration/orchestration.module';

@Module({
  imports: [OrchestrationModule],
  controllers: [AnalyzeController],
})
export class AnalyzeModule {}

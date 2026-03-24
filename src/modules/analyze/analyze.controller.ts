import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AnalyzeOrchestratorService } from '../../core/orchestration/analyze-orchestrator.service';
import { AnalyzeDto } from '../../data/dto/analyze/analyze.dto';

@Controller('v1/analyze')
export class AnalyzeController {
  constructor(private readonly orchestrator: AnalyzeOrchestratorService) {}

  @Post()
  analyze(@Body() body: AnalyzeDto) {
    return this.orchestrator.analyzeMessage({
      message: body.message,
      requestId: body.request_id ?? null,
      threadId: body.thread_id ?? null,
      timeWindow: body.time_window ?? '24h',
      preferredChain: body.preferred_chain ?? null,
    });
  }

  @Sse(':requestId/stream')
  stream(@Param('requestId') requestId: string): Observable<MessageEvent> {
    return this.orchestrator.stream(requestId);
  }

  @Get(':requestId/result')
  result(@Param('requestId') requestId: string) {
    return this.orchestrator.getResult(requestId);
  }

  @Get('modules/readiness')
  getReadiness() {
    return {
      modules: this.orchestrator.getModuleReadiness(),
    };
  }

  @Get('cache/metrics')
  getCacheMetrics() {
    return {
      identitySearch: this.orchestrator.getSearchCacheMetrics(),
    };
  }
}

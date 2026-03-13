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
import { BootstrapDto } from '../../data/dto/analyze/bootstrap.dto';
import { SelectDto } from '../../data/dto/analyze/select.dto';

@Controller('v1/analyze')
export class AnalyzeController {
  constructor(private readonly orchestrator: AnalyzeOrchestratorService) {}

  @Post('bootstrap')
  bootstrap(@Body() body: BootstrapDto) {
    return this.orchestrator.bootstrap(
      body.query,
      body.time_window ?? '24h',
      body.preferred_chain ?? null,
      body.thread_id ?? null,
    );
  }

  @Post('select')
  select(@Body() body: SelectDto) {
    return this.orchestrator.select(
      body.request_id,
      body.candidate_id,
      body.target_key ?? null,
    );
  }

  @Get('result/:requestId')
  result(@Param('requestId') requestId: string) {
    return this.orchestrator.getResult(requestId);
  }

  @Sse('stream/:requestId')
  stream(@Param('requestId') requestId: string): Observable<MessageEvent> {
    return this.orchestrator.stream(requestId);
  }

  @Get('modules/readiness')
  getReadiness() {
    return {
      modules: this.orchestrator.getModuleReadiness(),
    };
  }
}

import { Module } from '@nestjs/common';
import { MarketModule } from '../data/market/market.module';
import { NewsModule } from '../data/news/news.module';
import { TokenomicsModule } from '../data/tokenomics/tokenomics.module';
import { TechnicalModule } from '../data/technical/technical.module';
import { OnchainModule } from '../data/onchain/onchain.module';
import { SecurityModule } from '../data/security/security.module';
import { LiquidityModule } from '../data/liquidity/liquidity.module';
import { AlertsModule } from '../risk/alerts/alerts.module';
import { StrategyModule } from '../strategy/strategy.module';
import { LlmRuntimeService } from './runtime/llm-runtime.service';
import { IntentNodeService } from './nodes/intent-node.service';
import { PlanningNodeService } from './nodes/planning-node.service';
import { DataExecutorNodeService } from './nodes/data-executor-node.service';
import { AnalysisNodeService } from './nodes/analysis-node.service';
import { ReportNodeService } from './nodes/report-node.service';
import { AnalysisWorkflowService } from './engine/analysis-workflow.service';
import { IntentMemoService } from './state/intent-memo.service';

@Module({
  imports: [
    MarketModule,
    NewsModule,
    TokenomicsModule,
    TechnicalModule,
    OnchainModule,
    SecurityModule,
    LiquidityModule,
    AlertsModule,
    StrategyModule,
  ],
  providers: [
    LlmRuntimeService,
    IntentNodeService,
    PlanningNodeService,
    DataExecutorNodeService,
    AnalysisNodeService,
    ReportNodeService,
    IntentMemoService,
    AnalysisWorkflowService,
  ],
  exports: [AnalysisWorkflowService, IntentMemoService],
})
export class WorkflowModule {}

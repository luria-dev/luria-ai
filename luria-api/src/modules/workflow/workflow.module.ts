import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { TokenomicsModule } from '../tokenomics/tokenomics.module';
import { TechnicalModule } from '../technical/technical.module';
import { OnchainModule } from '../onchain/onchain.module';
import { SecurityModule } from '../security/security.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { AlertsModule } from '../alerts/alerts.module';
import { StrategyModule } from '../strategy/strategy.module';
import { LlmRuntimeService } from './llm-runtime.service';
import { IntentNodeService } from './intent-node.service';
import { PlanningNodeService } from './planning-node.service';
import { DataExecutorNodeService } from './data-executor-node.service';
import { AnalysisNodeService } from './analysis-node.service';
import { ReportNodeService } from './report-node.service';
import { AnalysisWorkflowService } from './analysis-workflow.service';
import { IntentMemoService } from './intent-memo.service';

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

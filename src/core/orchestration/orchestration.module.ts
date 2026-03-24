import { Module } from '@nestjs/common';
import { AnalyzeOrchestratorService } from './analyze-orchestrator.service';
import { SearcherModule } from '../../modules/data/searcher/searcher.module';
import { MarketModule } from '../../modules/data/market/market.module';
import { TokenomicsModule } from '../../modules/data/tokenomics/tokenomics.module';
import { FundamentalsModule } from '../../modules/data/fundamentals/fundamentals.module';
import { TechnicalModule } from '../../modules/data/technical/technical.module';
import { OnchainModule } from '../../modules/data/onchain/onchain.module';
import { SentimentModule } from '../../modules/data/sentiment/sentiment.module';
import { SecurityModule } from '../../modules/data/security/security.module';
import { LiquidityModule } from '../../modules/data/liquidity/liquidity.module';
import { AlertsModule } from '../../modules/risk/alerts/alerts.module';
import { StrategyModule } from '../../modules/strategy/strategy.module';
import { ReporterModule } from '../../modules/reporter/reporter.module';
import { NewsModule } from '../../modules/data/news/news.module';
import { WorkflowModule } from '../../modules/workflow/workflow.module';
import { RequestStateService } from './services/request-state.service';
import { AnalyzeQueueService } from './services/analyze-queue.service';
import { ComparisonService } from './services/comparison.service';

@Module({
  imports: [
    SearcherModule,
    MarketModule,
    NewsModule,
    TokenomicsModule,
    FundamentalsModule,
    TechnicalModule,
    OnchainModule,
    SentimentModule,
    SecurityModule,
    LiquidityModule,
    AlertsModule,
    StrategyModule,
    ReporterModule,
    WorkflowModule,
  ],
  providers: [
    RequestStateService,
    AnalyzeQueueService,
    ComparisonService,
    AnalyzeOrchestratorService,
  ],
  exports: [AnalyzeOrchestratorService],
})
export class OrchestrationModule {}

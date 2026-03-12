import { Module } from '@nestjs/common';
import { AnalyzeOrchestratorService } from './analyze-orchestrator.service';
import { SearcherModule } from '../../modules/searcher/searcher.module';
import { MarketModule } from '../../modules/market/market.module';
import { TokenomicsModule } from '../../modules/tokenomics/tokenomics.module';
import { TechnicalModule } from '../../modules/technical/technical.module';
import { OnchainModule } from '../../modules/onchain/onchain.module';
import { SentimentModule } from '../../modules/sentiment/sentiment.module';
import { SecurityModule } from '../../modules/security/security.module';
import { LiquidityModule } from '../../modules/liquidity/liquidity.module';
import { AlertsModule } from '../../modules/alerts/alerts.module';
import { StrategyModule } from '../../modules/strategy/strategy.module';
import { ReporterModule } from '../../modules/reporter/reporter.module';
import { NewsModule } from '../../modules/news/news.module';
import { WorkflowModule } from '../../modules/workflow/workflow.module';

@Module({
  imports: [
    SearcherModule,
    MarketModule,
    NewsModule,
    TokenomicsModule,
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
  providers: [AnalyzeOrchestratorService],
  exports: [AnalyzeOrchestratorService],
})
export class OrchestrationModule {}

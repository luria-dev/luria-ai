import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  CexNetflowSnapshot,
  LiquiditySnapshot,
  NewsSnapshot,
  PriceSnapshot,
  SecuritySnapshot,
  TechnicalSnapshot,
  TokenomicsSnapshot,
} from '../../core/contracts/analyze-contracts';
import {
  DataType,
  ExecutionOutput,
  PlanOutput,
} from '../../core/contracts/workflow-contracts';
import { MarketService } from '../market/market.service';
import { NewsService } from '../news/news.service';
import { TokenomicsService } from '../tokenomics/tokenomics.service';
import { TechnicalService } from '../technical/technical.service';
import { OnchainService } from '../onchain/onchain.service';
import { SecurityService } from '../security/security.service';
import { LiquidityService } from '../liquidity/liquidity.service';

type ExecuteInput = {
  plan: PlanOutput;
  identity: AnalyzeIdentity;
  timeWindow: '24h' | '7d';
};

@Injectable()
export class DataExecutorNodeService {
  private readonly logger = new Logger(DataExecutorNodeService.name);

  constructor(
    private readonly market: MarketService,
    private readonly news: NewsService,
    private readonly tokenomics: TokenomicsService,
    private readonly technical: TechnicalService,
    private readonly onchain: OnchainService,
    private readonly security: SecurityService,
    private readonly liquidity: LiquidityService,
  ) {}

  async execute(input: ExecuteInput): Promise<ExecutionOutput> {
    const requestedTypes = this.unique(
      input.plan.requirements.filter((item) => item.required).map((item) => item.dataType),
    );
    const strategyMandatory: DataType[] = [
      'price',
      'tokenomics',
      'technical',
      'onchain',
      'security',
      'liquidity',
    ];
    const executedTypes = this.unique([...requestedTypes, ...strategyMandatory]);

    const routing = executedTypes.map((dataType) => {
      const requirement = input.plan.requirements.find((item) => item.dataType === dataType);
      return {
        dataType,
        sourceHint: requirement?.sourceHint ?? [],
        selectedSource: this.selectSource(dataType, requirement?.sourceHint ?? []),
      };
    });

    const [
      priceSnapshot,
      newsSnapshot,
      tokenomicsSnapshot,
      technicalSnapshot,
      onchainSnapshot,
      securitySnapshot,
      liquiditySnapshot,
    ] = await Promise.all([
      this.runFetch(
        executedTypes.includes('price'),
        () => this.market.fetchPrice(input.identity),
        () => this.buildFallbackPrice('PRICE_NOT_REQUESTED'),
        () => this.buildFallbackPrice('PRICE_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('news'),
        () => this.news.fetchLatest(input.identity),
        () => this.buildFallbackNews('NEWS_NOT_REQUESTED'),
        () => this.buildFallbackNews('NEWS_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('tokenomics'),
        () => this.tokenomics.fetchSnapshot(input.identity),
        () => this.buildFallbackTokenomics('TOKENOMICS_NOT_REQUESTED'),
        () => this.buildFallbackTokenomics('TOKENOMICS_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('technical'),
        () => this.technical.fetchSnapshot(input.identity, input.timeWindow),
        () => this.buildFallbackTechnical('TECHNICAL_NOT_REQUESTED'),
        () => this.buildFallbackTechnical('TECHNICAL_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('onchain'),
        () => this.onchain.fetchCexNetflow(input.identity, input.timeWindow),
        () => this.buildFallbackOnchain(input.timeWindow, 'ONCHAIN_NOT_REQUESTED'),
        () => this.buildFallbackOnchain(input.timeWindow, 'ONCHAIN_FETCH_FAILED'),
      ),
      this.runCriticalFetch(
        executedTypes.includes('security'),
        () => this.security.fetchSnapshot(input.identity),
      ),
      this.runFetch(
        executedTypes.includes('liquidity'),
        () => this.liquidity.fetchSnapshot(input.identity),
        () => this.buildFallbackLiquidity('LIQUIDITY_NOT_REQUESTED'),
        () => this.buildFallbackLiquidity('LIQUIDITY_FETCH_FAILED'),
      ),
    ]);

    const degradedNodes: DataType[] = [];
    const collectedTypes: DataType[] = [];

    const collect = (type: DataType, degraded: boolean) => {
      if (degraded) {
        degradedNodes.push(type);
      } else {
        collectedTypes.push(type);
      }
    };

    collect('price', priceSnapshot.degraded);
    collect('news', newsSnapshot.degraded);
    collect('tokenomics', tokenomicsSnapshot.degraded);
    collect('technical', technicalSnapshot.degraded);
    collect('onchain', onchainSnapshot.degraded);
    collect('security', securitySnapshot.degraded);
    collect('liquidity', liquiditySnapshot.degraded);

    const missingEvidence: string[] = [];
    if (tokenomicsSnapshot.tokenomicsEvidenceInsufficient) {
      missingEvidence.push('tokenomics');
    }
    if (newsSnapshot.items.length === 0) {
      missingEvidence.push('news');
    }
    if (priceSnapshot.priceUsd === null) {
      missingEvidence.push('price');
    }

    return {
      identity: input.identity,
      requestedTypes,
      executedTypes,
      collectedTypes,
      degradedNodes,
      missingEvidence,
      routing,
      data: {
        market: { price: priceSnapshot },
        news: newsSnapshot,
        tokenomics: tokenomicsSnapshot,
        technical: technicalSnapshot,
        onchain: { cexNetflow: onchainSnapshot },
        security: securitySnapshot,
        liquidity: liquiditySnapshot,
      },
      asOf: new Date().toISOString(),
    };
  }

  private async runFetch<T extends { degraded: boolean }>(
    enabled: boolean,
    fetcher: () => T | Promise<T>,
    disabledFallback: () => T,
    errorFallback: () => T,
  ): Promise<T> {
    if (!enabled) {
      return disabledFallback();
    }

    try {
      return await fetcher();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Data fetch failed: ${message}`);
      return errorFallback();
    }
  }

  private async runCriticalFetch<T extends { degraded: boolean }>(
    enabled: boolean,
    fetcher: () => T | Promise<T>,
  ): Promise<T> {
    if (!enabled) {
      throw new Error('SECURITY_CRITICAL_NODE_DISABLED');
    }
    return fetcher();
  }

  private selectSource(dataType: DataType, sourceHint: string[]): string {
    if (sourceHint.length > 0) {
      return sourceHint[0];
    }

    const defaults: Record<DataType, string> = {
      price: 'dexscreener',
      news: 'cryptopanic',
      tokenomics: 'messari',
      technical: 'coingecko',
      onchain: 'coinglass',
      security: 'goplus',
      liquidity: 'dexscreener',
    };
    return defaults[dataType];
  }

  private unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
  }

  private buildFallbackPrice(reason: string): PriceSnapshot {
    return {
      priceUsd: null,
      change1hPct: null,
      change24hPct: null,
      change7dPct: null,
      change30dPct: null,
      asOf: new Date().toISOString(),
      sourceUsed: 'market_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackNews(reason: string): NewsSnapshot {
    return {
      items: [],
      asOf: new Date().toISOString(),
      sourceUsed: 'news_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackTokenomics(reason: string): TokenomicsSnapshot {
    return {
      allocation: {
        teamPct: null,
        investorPct: null,
        communityPct: null,
        foundationPct: null,
      },
      vestingSchedule: [],
      inflationRate: {
        currentAnnualPct: null,
        targetAnnualPct: null,
        isDynamic: false,
      },
      evidence: [],
      evidenceConflicts: [],
      asOf: new Date().toISOString(),
      sourceUsed: [],
      degraded: true,
      degradeReason: reason,
      tokenomicsEvidenceInsufficient: true,
    };
  }

  private buildFallbackTechnical(reason: string): TechnicalSnapshot {
    return {
      rsi: {
        period: 14,
        value: null,
        signal: 'neutral',
      },
      macd: {
        macd: null,
        signalLine: null,
        histogram: null,
        signal: 'neutral',
      },
      ma: {
        ma7: null,
        ma25: null,
        ma99: null,
        signal: 'neutral',
      },
      boll: {
        upper: null,
        middle: null,
        lower: null,
        bandwidth: null,
        signal: 'neutral',
      },
      summarySignal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'technical_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackOnchain(window: '24h' | '7d', reason: string): CexNetflowSnapshot {
    return {
      window,
      inflowUsd: null,
      outflowUsd: null,
      netflowUsd: null,
      signal: 'neutral',
      exchanges: [],
      asOf: new Date().toISOString(),
      sourceUsed: [],
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackSecurity(reason: string): SecuritySnapshot {
    return {
      isContractOpenSource: null,
      isHoneypot: null,
      isOwnerRenounced: null,
      riskScore: null,
      riskLevel: 'unknown',
      riskItems: [],
      canTradeSafely: null,
      asOf: new Date().toISOString(),
      sourceUsed: 'security_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackLiquidity(reason: string): LiquiditySnapshot {
    return {
      quoteToken: 'OTHER',
      hasUsdtOrUsdcPair: false,
      pairAddress: null,
      liquidityUsd: null,
      liquidity1hAgoUsd: null,
      liquidityDrop1hPct: null,
      withdrawalRiskFlag: false,
      volume24hUsd: null,
      priceImpact1kPct: null,
      isLpLocked: null,
      lpLockRatioPct: null,
      rugpullRiskSignal: 'unknown',
      warnings: ['Liquidity source is unavailable for this token.'],
      asOf: new Date().toISOString(),
      sourceUsed: 'liquidity_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }
}

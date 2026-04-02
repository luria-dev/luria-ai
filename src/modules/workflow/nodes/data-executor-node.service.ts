import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  CexNetflowSnapshot,
  FundamentalsSnapshot,
  LiquiditySnapshot,
  NewsSnapshot,
  OpenResearchSnapshot,
  PriceSnapshot,
  SecuritySnapshot,
  SentimentSnapshot,
  TechnicalSnapshot,
  TokenomicsSnapshot,
} from '../../../data/contracts/analyze-contracts';
import {
  DataType,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
} from '../../../data/contracts/workflow-contracts';
import { MarketService } from '../../data/market/market.service';
import { NewsService } from '../../data/news/news.service';
import { TokenomicsService } from '../../data/tokenomics/tokenomics.service';
import { FundamentalsService } from '../../data/fundamentals/fundamentals.service';
import { TechnicalService } from '../../data/technical/technical.service';
import { OnchainService } from '../../data/onchain/onchain.service';
import { SecurityService } from '../../data/security/security.service';
import { LiquidityService } from '../../data/liquidity/liquidity.service';
import { SentimentService } from '../../data/sentiment/sentiment.service';
import { DataCacheService } from '../../data/cache/data-cache.service';
import { OpenResearchService } from '../../data/open-research/open-research.service';

type ExecuteInput = {
  query: string;
  plan: PlanOutput;
  identity: AnalyzeIdentity;
  timeWindow: '24h' | '7d' | '30d' | '60d';
  objective: IntentOutput['objective'];
  taskType: IntentOutput['taskType'];
};

@Injectable()
export class DataExecutorNodeService {
  private readonly logger = new Logger(DataExecutorNodeService.name);

  constructor(
    private readonly market: MarketService,
    private readonly news: NewsService,
    private readonly tokenomics: TokenomicsService,
    private readonly fundamentals: FundamentalsService,
    private readonly technical: TechnicalService,
    private readonly onchain: OnchainService,
    private readonly security: SecurityService,
    private readonly liquidity: LiquidityService,
    private readonly sentiment: SentimentService,
    private readonly openResearch: OpenResearchService,
    private readonly cache: DataCacheService,
  ) {}

  async execute(input: ExecuteInput): Promise<ExecutionOutput> {
    const allDataTypes: DataType[] = [
      'price',
      'news',
      'tokenomics',
      'fundamentals',
      'technical',
      'onchain',
      'security',
      'liquidity',
      'sentiment',
    ];
    const requestedTypes = this.unique(
      input.plan.requirements
        .filter((item) => item.required)
        .map((item) => item.dataType),
    );
    const strategyMandatory: DataType[] = [
      'price',
      'tokenomics',
      'fundamentals',
      'technical',
      'onchain',
      'security',
      'liquidity',
      'sentiment',
    ];
    const executedTypes = this.unique([
      ...requestedTypes,
      ...strategyMandatory,
    ]);

    const routing = executedTypes.map((dataType) => {
      const requirement = input.plan.requirements.find(
        (item) => item.dataType === dataType,
      );
      return {
        dataType,
        sourceHint: requirement?.sourceHint ?? [],
        selectedSource: this.selectSource(
          dataType,
          requirement?.sourceHint ?? [],
        ),
      };
    });
    const selectedSourceByType = new Map(
      routing.map((item) => [item.dataType, item.selectedSource]),
    );
    const selectedSource = (dataType: DataType): string =>
      selectedSourceByType.get(dataType) ?? this.selectSource(dataType, []);

    const [
      priceSnapshot,
      newsSnapshot,
      openResearchSnapshot,
      tokenomicsSnapshot,
      fundamentalsSnapshot,
      technicalSnapshot,
      onchainSnapshot,
      securitySnapshot,
      liquiditySnapshot,
      sentimentSnapshot,
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
        input.plan.openResearch.enabled,
        () =>
          this.openResearch.fetchSnapshot({
            query: input.query,
            identity: input.identity,
            depth: input.plan.openResearch.depth,
            topics: input.plan.openResearch.topics,
            goals: input.plan.openResearch.goals,
            preferredSources: input.plan.openResearch.preferredSources,
          }),
        () =>
          this.buildFallbackOpenResearch(input.plan, 'OPEN_RESEARCH_DISABLED'),
        () =>
          this.buildFallbackOpenResearch(
            input.plan,
            'OPEN_RESEARCH_FETCH_FAILED',
          ),
      ),
      this.runFetch(
        executedTypes.includes('tokenomics'),
        () =>
          this.cache.readThrough({
            dataType: 'tokenomics',
            identity: input.identity,
            objective: input.objective,
            taskType: input.taskType,
            source: selectedSource('tokenomics'),
            fetcher: () => this.tokenomics.fetchSnapshot(input.identity),
          }),
        () => this.buildFallbackTokenomics('TOKENOMICS_NOT_REQUESTED'),
        () => this.buildFallbackTokenomics('TOKENOMICS_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('fundamentals'),
        () =>
          this.cache.readThrough({
            dataType: 'fundamentals',
            identity: input.identity,
            objective: input.objective,
            taskType: input.taskType,
            source: selectedSource('fundamentals'),
            fetcher: () => this.fundamentals.fetchSnapshot(input.identity),
          }),
        () => this.buildFallbackFundamentals('FUNDAMENTALS_NOT_REQUESTED'),
        () => this.buildFallbackFundamentals('FUNDAMENTALS_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('technical'),
        () => this.technical.fetchSnapshot(input.identity, input.timeWindow),
        () => this.buildFallbackTechnical('TECHNICAL_NOT_REQUESTED'),
        () => this.buildFallbackTechnical('TECHNICAL_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('onchain'),
        () =>
          this.cache.readThrough({
            dataType: 'onchain',
            identity: input.identity,
            objective: input.objective,
            taskType: input.taskType,
            timeWindow: input.timeWindow,
            source: selectedSource('onchain'),
            fetcher: () =>
              this.onchain.fetchCexNetflow(input.identity, input.timeWindow),
          }),
        () =>
          this.buildFallbackOnchain(input.timeWindow, 'ONCHAIN_NOT_REQUESTED'),
        () =>
          this.buildFallbackOnchain(input.timeWindow, 'ONCHAIN_FETCH_FAILED'),
      ),
      this.runCriticalFetch(executedTypes.includes('security'), () =>
        this.cache.readThrough({
          dataType: 'security',
          identity: input.identity,
          objective: input.objective,
          taskType: input.taskType,
          source: selectedSource('security'),
          fetcher: () => this.security.fetchSnapshot(input.identity),
        }),
      ),
      this.runFetch(
        executedTypes.includes('liquidity'),
        () => this.liquidity.fetchSnapshot(input.identity),
        () => this.buildFallbackLiquidity('LIQUIDITY_NOT_REQUESTED'),
        () => this.buildFallbackLiquidity('LIQUIDITY_FETCH_FAILED'),
      ),
      this.runFetch(
        executedTypes.includes('sentiment'),
        () =>
          this.cache.readThrough({
            dataType: 'sentiment',
            identity: input.identity,
            objective: input.objective,
            taskType: input.taskType,
            source: selectedSource('sentiment'),
            fetcher: () => this.sentiment.fetchSentiment(input.identity),
          }),
        () => this.buildFallbackSentiment('SENTIMENT_NOT_REQUESTED'),
        () => this.buildFallbackSentiment('SENTIMENT_FETCH_FAILED'),
      ),
    ]);

    const degradedNodes: DataType[] = [];
    const collectedTypes: DataType[] = [];

    const collect = (type: DataType, degraded: boolean) => {
      if (!executedTypes.includes(type)) {
        return;
      }
      if (degraded) {
        degradedNodes.push(type);
      } else {
        collectedTypes.push(type);
      }
    };

    collect('price', priceSnapshot.degraded);
    collect('news', newsSnapshot.degraded);
    collect('tokenomics', tokenomicsSnapshot.degraded);
    collect('fundamentals', fundamentalsSnapshot.degraded);
    collect('technical', technicalSnapshot.degraded);
    collect('onchain', onchainSnapshot.degraded);
    collect('security', securitySnapshot.degraded);
    collect('liquidity', liquiditySnapshot.degraded);
    collect('sentiment', sentimentSnapshot.degraded);

    const missingEvidence: string[] = [];
    if (tokenomicsSnapshot.tokenomicsEvidenceInsufficient) {
      missingEvidence.push('tokenomics');
    }
    if (executedTypes.includes('news') && newsSnapshot.items.length === 0) {
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
        openResearch: openResearchSnapshot,
        tokenomics: tokenomicsSnapshot,
        fundamentals: fundamentalsSnapshot,
        technical: technicalSnapshot,
        onchain: { cexNetflow: onchainSnapshot },
        security: securitySnapshot,
        liquidity: liquiditySnapshot,
        sentiment: sentimentSnapshot,
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
      price: 'coingecko',
      news: 'coindesk',
      tokenomics: 'tokenomist',
      fundamentals: 'rootdata',
      technical: 'coingecko',
      onchain: 'santiment',
      security: 'goplus',
      liquidity: 'geckoterminal',
      sentiment: 'santiment',
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
      marketCapRank: null,
      circulatingSupply: null,
      totalSupply: null,
      maxSupply: null,
      fdvUsd: null,
      totalVolume24hUsd: null,
      athUsd: null,
      atlUsd: null,
      athChangePct: null,
      atlChangePct: null,
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
      burns: {
        totalBurnAmount: null,
        recentBurns: [],
      },
      buybacks: {
        totalBuybackAmount: null,
        recentBuybacks: [],
      },
      fundraising: {
        totalRaised: null,
        rounds: [],
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

  private buildFallbackOpenResearch(
    plan: PlanOutput,
    reason: string,
  ): OpenResearchSnapshot {
    return {
      enabled: plan.openResearch.enabled,
      query: '',
      topics: plan.openResearch.topics,
      goals: plan.openResearch.goals,
      preferredSources: plan.openResearch.preferredSources,
      takeaways: [],
      items: [],
      asOf: new Date().toISOString(),
      sourceUsed: [],
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackFundamentals(reason: string): FundamentalsSnapshot {
    return {
      profile: {
        projectId: null,
        name: null,
        tokenSymbol: null,
        oneLiner: null,
        description: null,
        establishmentDate: null,
        active: null,
        logoUrl: null,
        rootdataUrl: null,
        tags: [],
        totalFundingUsd: null,
        rtScore: null,
        tvlScore: null,
        similarProjects: [],
      },
      team: [],
      investors: [],
      fundraising: [],
      ecosystems: {
        ecosystems: [],
        onMainNet: [],
        onTestNet: [],
        planToLaunch: [],
      },
      social: {
        heat: null,
        heatRank: null,
        influence: null,
        influenceRank: null,
        followers: null,
        following: null,
        hotIndexScore: null,
        hotIndexRank: null,
        xHeatScore: null,
        xHeatRank: null,
        xInfluenceScore: null,
        xInfluenceRank: null,
        xFollowersScore: null,
        xFollowersRank: null,
        socialLinks: [],
      },
      asOf: new Date().toISOString(),
      sourceUsed: ['rootdata'],
      degraded: true,
      degradeReason: reason,
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
      atr: { value: null, period: 14 },
      swingHigh: null,
      swingLow: null,
      summarySignal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'technical_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }

  private buildFallbackOnchain(
    window: '24h' | '7d' | '30d' | '60d',
    reason: string,
  ): CexNetflowSnapshot {
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
      holderCount: null,
      lpHolderCount: null,
      creatorPercent: null,
      ownerPercent: null,
      isInCex: null,
      cexList: [],
      isInDex: null,
      transferPausable: null,
      selfdestruct: null,
      externalCall: null,
      honeypotWithSameCreator: null,
      trustList: null,
      isAntiWhale: null,
      transferTax: null,
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

  private buildFallbackSentiment(reason: string): SentimentSnapshot {
    return {
      socialVolume: null,
      socialDominance: null,
      sentimentPositive: null,
      sentimentNegative: null,
      sentimentBalanced: null,
      sentimentScore: null,
      devActivity: null,
      githubActivity: null,
      signal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'sentiment_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }
}

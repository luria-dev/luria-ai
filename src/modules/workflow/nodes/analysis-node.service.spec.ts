import { AnalysisNodeService } from './analysis-node.service';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { StrategyService } from '../../strategy/strategy.service';

describe('AnalysisNodeService', () => {
  const runtimeStub: Pick<LlmRuntimeService, 'generateStructuredWithMeta'> = {
    async generateStructuredWithMeta<T>(input: {
      fallback: () => T;
    }): Promise<{
      data: T;
      meta: {
        llmStatus: 'fallback';
        attempts: 1;
        schemaCorrection: false;
        model: null;
      };
    }> {
      return {
        data: input.fallback(),
        meta: {
          llmStatus: 'fallback',
          attempts: 1,
          schemaCorrection: false,
          model: null,
        },
      };
    },
  };

  function createService() {
    return new AnalysisNodeService(
      runtimeStub as LlmRuntimeService,
      new StrategyService(),
    );
  }

  function createServiceWithRuntime(
    runtime: Pick<LlmRuntimeService, 'generateStructuredWithMeta'>,
  ) {
    return new AnalysisNodeService(
      runtime as LlmRuntimeService,
      new StrategyService(),
    );
  }

  function buildInput(overrides?: Record<string, unknown>) {
    const input = {
      intent: {
        userQuery: 'Analyze ETH',
        language: 'en',
        interactionType: 'new_query',
        taskType: 'single_asset',
        outputGoal: 'analysis',
        needsClarification: false,
        objective: 'market_overview',
        sentimentBias: 'unknown',
        timeWindow: '24h',
        entities: ['ETH'],
        entityMentions: ['ETH'],
        symbols: ['ETH'],
        chains: ['ethereum'],
        focusAreas: ['price_action', 'technical_indicators', 'onchain_flow'],
        constraints: [],
      },
      plan: {
        requirements: [],
        analysisQuestions: ['What is the current setup?'],
      },
      execution: {
        identity: {
          symbol: 'ETH',
          chain: 'ethereum',
          tokenAddress: '0x0000000000000000000000000000000000000000',
          sourceId: 'coingecko:ethereum',
        },
        requestedTypes: ['price', 'technical', 'onchain', 'security', 'liquidity', 'tokenomics', 'sentiment'],
        executedTypes: ['price', 'technical', 'onchain', 'security', 'liquidity', 'tokenomics', 'sentiment', 'fundamentals'],
        collectedTypes: ['price', 'technical', 'onchain', 'security', 'liquidity', 'tokenomics', 'sentiment', 'fundamentals'],
        degradedNodes: [],
        missingEvidence: [],
        routing: [],
        asOf: new Date().toISOString(),
        data: {
          market: {
            price: {
              priceUsd: 3200,
              change1hPct: 0.8,
              change24hPct: 5.2,
              change7dPct: 8.1,
              change30dPct: 12.4,
              marketCapRank: 2,
              circulatingSupply: 120000000,
              totalSupply: 120000000,
              maxSupply: null,
              fdvUsd: 384000000000,
              totalVolume24hUsd: 24000000000,
              athUsd: 4800,
              atlUsd: 0.4,
              athChangePct: -33.3,
              atlChangePct: 799900,
              asOf: new Date().toISOString(),
              sourceUsed: 'coingecko',
              degraded: false,
            },
          },
          news: {
            items: [],
            asOf: new Date().toISOString(),
            sourceUsed: 'coindesk',
            degraded: false,
          },
          tokenomics: {
            allocation: {
              teamPct: 15,
              investorPct: 20,
              communityPct: 45,
              foundationPct: 20,
            },
            vestingSchedule: [],
            inflationRate: {
              currentAnnualPct: 3.5,
              targetAnnualPct: null,
              isDynamic: false,
            },
            evidence: [],
            evidenceConflicts: [],
            asOf: new Date().toISOString(),
            sourceUsed: ['tokenomist'],
            degraded: false,
            tokenomicsEvidenceInsufficient: false,
          },
          fundamentals: {
            profile: {
              projectId: 1,
              name: 'Ethereum',
              tokenSymbol: 'ETH',
              oneLiner: 'Programmable settlement network',
              description: null,
              establishmentDate: '2015',
              active: true,
              logoUrl: null,
              rootdataUrl: null,
              tags: ['L1'],
              totalFundingUsd: null,
              rtScore: 1500,
              tvlScore: null,
              similarProjects: [],
            },
            team: [],
            investors: [],
            fundraising: [],
            ecosystems: {
              ecosystems: ['DeFi'],
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
            degraded: false,
          },
          technical: {
            rsi: { period: 14, value: 42, signal: 'bullish' },
            macd: { macd: 12, signalLine: 8, histogram: 4, signal: 'bullish' },
            ma: { ma7: 3150, ma25: 3050, ma99: 2800, signal: 'bullish' },
            boll: { upper: 3300, middle: 3100, lower: 2950, bandwidth: 0.08, signal: 'bullish' },
            atr: { value: 90, period: 14 },
            swingHigh: 3400,
            swingLow: 2800,
            summarySignal: 'bullish',
            asOf: new Date().toISOString(),
            sourceUsed: 'coingecko',
            degraded: false,
          },
          onchain: {
            cexNetflow: {
              window: '24h',
              inflowUsd: 1000000,
              outflowUsd: 3500000,
              netflowUsd: -2500000,
              signal: 'buy_pressure',
              exchanges: [],
              asOf: new Date().toISOString(),
              sourceUsed: [],
              degraded: false,
            },
          },
          security: {
            isContractOpenSource: true,
            isHoneypot: false,
            isOwnerRenounced: true,
            riskScore: 12,
            riskLevel: 'low',
            riskItems: [],
            canTradeSafely: true,
            holderCount: 100000,
            lpHolderCount: 100,
            creatorPercent: 0,
            ownerPercent: 0,
            isInCex: true,
            cexList: [],
            isInDex: true,
            transferPausable: false,
            selfdestruct: false,
            externalCall: false,
            honeypotWithSameCreator: false,
            trustList: true,
            isAntiWhale: false,
            transferTax: 0,
            asOf: new Date().toISOString(),
            sourceUsed: 'goplus',
            degraded: false,
          },
          liquidity: {
            quoteToken: 'USDT',
            hasUsdtOrUsdcPair: true,
            liquidityUsd: 1200000,
            liquidity1hAgoUsd: 1180000,
            liquidityDrop1hPct: -1.7,
            withdrawalRiskFlag: false,
            volume24hUsd: 450000,
            priceImpact1kPct: 0.2,
            isLpLocked: null,
            lpLockRatioPct: null,
            rugpullRiskSignal: 'low',
            warnings: [],
            asOf: new Date().toISOString(),
            sourceUsed: 'geckoterminal',
            degraded: false,
          },
          sentiment: {
            socialVolume: 1200,
            socialDominance: 2.4,
            sentimentPositive: 60,
            sentimentNegative: 30,
            sentimentBalanced: 30,
            sentimentScore: 22,
            devActivity: 35,
            githubActivity: 48,
            signal: 'bullish',
            asOf: new Date().toISOString(),
            sourceUsed: 'santiment',
            degraded: false,
          },
        },
      },
      alerts: {
        alertLevel: 'yellow',
        riskState: 'warning',
        redCount: 0,
        yellowCount: 0,
        items: [],
      },
    } as any;

    return {
      ...input,
      ...(overrides ?? {}),
    };
  }

  it('should use analysis-local heuristic fallback when llm falls back and core data is healthy', async () => {
    const service = createService();

    const result = await service.analyzeWithMeta(buildInput());

    expect(result.meta.llmStatus).toBe('fallback');
    expect(result.analysis.verdict).toBe('BUY');
    expect(result.analysis.confidence).toBeGreaterThan(0.65);
    expect(result.analysis.evidence.length).toBeGreaterThan(0);
    expect(result.analysis.summary).toContain('BUY');
  });

  it('should skip llm entirely when hard risk gate triggers', async () => {
    const service = createService();
    const input = buildInput();
    input.execution.data.security.isHoneypot = true;
    input.alerts.redCount = 1;
    input.alerts.alertLevel = 'red';

    const result = await service.analyzeWithMeta(input);

    expect(result.meta.llmStatus).toBe('skipped');
    expect(result.analysis.verdict).toBe('SELL');
    expect(result.analysis.hardBlocks).toContain('SECURITY_HONEYPOT');
  });

  it('should use degraded analysis mode instead of skipping when core data is incomplete', async () => {
    const service = createService();
    const input = buildInput();
    input.execution.data.technical.degraded = true;

    const result = await service.analyzeWithMeta(input);

    expect(result.meta.llmStatus).toBe('fallback');
    expect(result.analysis.verdict).toBe('INSUFFICIENT_DATA');
    expect(result.analysis.buyZone).toBeNull();
    expect(result.analysis.sellZone).toBeNull();
    expect(result.analysis.tradingStrategy).toBeUndefined();
    expect(result.analysis.dataQualityNotes.join(' ')).toContain('degraded');
  });

  it('should coerce degraded llm output away from directional verdicts', async () => {
    const runtime: Pick<LlmRuntimeService, 'generateStructuredWithMeta'> = {
      async generateStructuredWithMeta<T>(): Promise<{
        data: T;
        meta: {
          llmStatus: 'success';
          attempts: 1;
          schemaCorrection: false;
          model: 'gpt-5.4';
        };
      }> {
        return {
          data: {
            verdict: 'BUY',
            confidence: 0.91,
            reason: 'Bullish setup despite partial evidence.',
            buyZone: 'buy now',
            sellZone: 'sell later',
            evidence: ['Momentum looks strong'],
            summary: 'Bullish summary',
            keyObservations: ['Observation'],
            riskHighlights: [],
            opportunityHighlights: ['Opportunity'],
            dataQualityNotes: [],
          } as T,
          meta: {
            llmStatus: 'success',
            attempts: 1,
            schemaCorrection: false,
            model: 'gpt-5.4',
          },
        };
      },
    };
    const service = createServiceWithRuntime(runtime);
    const input = buildInput();
    input.execution.data.technical.degraded = true;

    const result = await service.analyzeWithMeta(input);

    expect(result.meta.llmStatus).toBe('success');
    expect(result.analysis.verdict).toBe('INSUFFICIENT_DATA');
    expect(result.analysis.confidence).toBeLessThanOrEqual(0.55);
    expect(result.analysis.buyZone).toBeNull();
    expect(result.analysis.sellZone).toBeNull();
  });
});

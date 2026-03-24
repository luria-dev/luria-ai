import { ReportNodeService } from './report-node.service';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';

describe('ReportNodeService', () => {
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

  it('should produce a readable report body from fallback data', async () => {
    const service = new ReportNodeService(runtimeStub as LlmRuntimeService);

    const result = await service.render({
      intent: {
        userQuery: '请分析 BTC 的投资价值',
        language: 'zh',
        interactionType: 'new_query',
        taskType: 'single_asset',
        outputGoal: 'analysis',
        needsClarification: false,
        objective: 'market_overview',
        sentimentBias: 'unknown',
        timeWindow: '24h',
        entities: ['BTC'],
        entityMentions: ['BTC'],
        symbols: ['BTC'],
        chains: ['bitcoin'],
        focusAreas: ['price_action', 'tokenomics'],
        constraints: [],
      },
      execution: {
        identity: {
          symbol: 'BTC',
          chain: 'bitcoin',
          tokenAddress: '',
          sourceId: 'coingecko:bitcoin',
        },
        requestedTypes: ['price', 'technical', 'onchain', 'security', 'liquidity', 'tokenomics', 'sentiment'],
        executedTypes: ['price', 'technical', 'onchain', 'security', 'liquidity', 'tokenomics', 'sentiment', 'fundamentals'],
        collectedTypes: ['price', 'technical', 'security', 'tokenomics', 'sentiment', 'fundamentals'],
        degradedNodes: ['onchain', 'liquidity'],
        missingEvidence: ['news'],
        routing: [],
        asOf: new Date().toISOString(),
        data: {
          market: {
            price: {
              priceUsd: 69175,
              change1hPct: -0.2,
              change24hPct: -2.19,
              change7dPct: -3.15,
              change30dPct: 2.88,
              marketCapRank: 1,
              circulatingSupply: 20000000,
              totalSupply: 20000000,
              maxSupply: 21000000,
              fdvUsd: 1383448497889,
              totalVolume24hUsd: 27254385186,
              athUsd: 126080,
              atlUsd: 67.81,
              athChangePct: -45.13,
              atlChangePct: 101914.14,
              asOf: new Date().toISOString(),
              sourceUsed: 'coingecko',
              degraded: false,
            },
          },
          news: {
            items: [],
            asOf: new Date().toISOString(),
            sourceUsed: 'news_unavailable',
            degraded: true,
            degradeReason: 'NEWS_NOT_REQUESTED',
          },
          tokenomics: {
            allocation: {
              teamPct: 0,
              investorPct: 0,
              communityPct: 0,
              foundationPct: 100,
            },
            vestingSchedule: [],
            inflationRate: {
              currentAnnualPct: 2.79,
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
              projectId: 2,
              name: 'Bitcoin',
              tokenSymbol: 'BTC',
              oneLiner: 'Decentralized digital currency',
              description: null,
              establishmentDate: '2008',
              active: true,
              logoUrl: null,
              rootdataUrl: null,
              tags: ['PoW'],
              totalFundingUsd: null,
              rtScore: 1392.218,
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
            degraded: false,
          },
          technical: {
            rsi: { period: 14, value: 30.08, signal: 'neutral' },
            macd: { macd: -361.45, signalLine: -264.45, histogram: -97, signal: 'bearish' },
            ma: { ma7: 69054, ma25: 70124, ma99: 70742, signal: 'bearish' },
            boll: { upper: 71424, middle: 69986, lower: 68548, bandwidth: 0.041, signal: 'neutral' },
            atr: { value: 263.21, period: 14 },
            swingHigh: 75632,
            swingLow: 65962,
            summarySignal: 'neutral',
            asOf: new Date().toISOString(),
            sourceUsed: 'coingecko',
            degraded: false,
          },
          onchain: {
            cexNetflow: {
              window: '24h',
              inflowUsd: null,
              outflowUsd: null,
              netflowUsd: null,
              signal: 'neutral',
              exchanges: [],
              asOf: new Date().toISOString(),
              sourceUsed: [],
              degraded: true,
              degradeReason: 'CEX_NETFLOW_SOURCE_NOT_FOUND',
            },
          },
          security: {
            isContractOpenSource: null,
            isHoneypot: false,
            isOwnerRenounced: null,
            riskScore: 5,
            riskLevel: 'low',
            riskItems: [],
            canTradeSafely: true,
            holderCount: null,
            lpHolderCount: null,
            creatorPercent: null,
            ownerPercent: null,
            isInCex: true,
            cexList: [],
            isInDex: null,
            transferPausable: null,
            selfdestruct: null,
            externalCall: null,
            honeypotWithSameCreator: null,
            trustList: null,
            isAntiWhale: null,
            transferTax: 0,
            asOf: new Date().toISOString(),
            sourceUsed: 'security_unavailable',
            degraded: false,
            degradeReason: 'NATIVE_TOKEN:BTC',
          },
          liquidity: {
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
            degradeReason: 'LIQUIDITY_SOURCE_NOT_FOUND',
          },
          sentiment: {
            socialVolume: 582,
            socialDominance: 1.44,
            sentimentPositive: 80.6,
            sentimentNegative: 94.7,
            sentimentBalanced: -14.1,
            sentimentScore: -8.7,
            devActivity: 9,
            githubActivity: 17,
            signal: 'neutral',
            asOf: new Date().toISOString(),
            sourceUsed: 'santiment',
            degraded: false,
          },
        },
      } as any,
      analysis: {
        verdict: 'INSUFFICIENT_DATA',
        confidence: 0.35,
        reason: 'Core evidence is incomplete for a directional decision.',
        buyZone: null,
        sellZone: null,
        evidence: ['No critical evidence'],
        summary: '策略结论: INSUFFICIENT_DATA (置信度 35%)\nCore evidence is incomplete for a directional decision.',
        keyObservations: ['Current price: $69175.000000', '24h change: -2.19%', 'Technical: neutral'],
        hardBlocks: [],
        riskHighlights: ['[WARNING] DATA_DEGRADED: One or more upstream data sources are degraded.'],
        opportunityHighlights: [],
        dataQualityNotes: ['⚠️ Degraded nodes: onchain, liquidity'],
        tradingStrategy: undefined,
      },
      alerts: {
        alertLevel: 'yellow',
        alertType: ['data_degraded'],
        riskState: 'elevated',
        redCount: 0,
        yellowCount: 1,
        items: [{ code: 'DATA_DEGRADED', severity: 'warning', message: 'One or more upstream data sources are degraded.' }],
        asOf: new Date().toISOString(),
      },
    });

    expect(result.body).toContain('BTC 分析报告');
    expect(result.body).toContain('关键信号');
    expect(result.body).toContain('69175.00');
    expect(result.body).toContain('Core evidence is incomplete');
    expect(result.body.length).toBeGreaterThan(200);
  });
});

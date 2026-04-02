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
      plan: {
        taskDisposition: 'analyze',
        primaryIntent: 'Assess BTC investment value.',
        subTasks: [
          'what supports the current BTC investment view',
          'what the biggest BTC risk is',
        ],
        responseMode: 'assess',
        requirements: [
          {
            dataType: 'price',
            required: true,
            priority: 'high',
            sourceHint: ['coingecko'],
            reason: 'Market context is required.',
          },
          {
            dataType: 'fundamentals',
            required: true,
            priority: 'high',
            sourceHint: ['rootdata'],
            reason: 'Investment value requires fundamentals.',
          },
          {
            dataType: 'tokenomics',
            required: true,
            priority: 'medium',
            sourceHint: ['tokenomist'],
            reason: 'Supply context is relevant.',
          },
        ],
        analysisQuestions: [
          'What supports the current investment view?',
          'What is the biggest risk?',
        ],
        openResearch: {
          enabled: true,
          depth: 'standard',
          priority: 'low',
          reason: 'Not needed in this test.',
          topics: [],
          goals: [],
          preferredSources: [],
          mustUseInReport: true,
        },
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
          openResearch: {
            enabled: false,
            query: '',
            topics: [],
            goals: [],
            preferredSources: [],
            takeaways: [],
            items: [],
            asOf: new Date().toISOString(),
            sourceUsed: [],
            degraded: true,
            degradeReason: 'OPEN_RESEARCH_DISABLED',
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

    expect(result.body).toContain('BTC 投资判断');
    expect(result.body).toContain('## 核心结论');
    expect(result.body).toContain('## 现在如何理解投资价值');
    expect(result.body).toContain('69175.00');
    expect(result.body).not.toContain('## 现在该怎么做');
    expect(result.body).not.toContain('## 关键触发位');
    expect(result.body).not.toContain('Core evidence is incomplete');
    expect(result.body).not.toContain('degraded');
    expect(result.body).not.toContain('数据不足');
    expect(result.reportMeta?.dataQualityNotes ?? []).toEqual([]);
    expect(result.body.length).toBeGreaterThan(200);
  });

  it('should scope multi-asset prompts to the current target only', async () => {
    let capturedUserPrompt = '';
    const scopedRuntimeStub: Pick<
      LlmRuntimeService,
      'generateStructuredWithMeta'
    > = {
      async generateStructuredWithMeta<T>(input: {
        userPrompt: string;
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
        capturedUserPrompt = input.userPrompt;
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

    const service = new ReportNodeService(
      scopedRuntimeStub as LlmRuntimeService,
    );

    await service.render({
      intent: {
        userQuery: '分析 BTC、ETH 接下来24小时走势，并分别给出策略建议',
        language: 'zh',
        interactionType: 'new_query',
        taskType: 'multi_asset',
        outputGoal: 'strategy',
        needsClarification: false,
        objective: 'timing_decision',
        sentimentBias: 'unknown',
        timeWindow: '24h',
        entities: ['BTC', 'ETH'],
        entityMentions: ['BTC', 'ETH'],
        symbols: ['BTC', 'ETH'],
        chains: ['bitcoin', 'ethereum'],
        focusAreas: ['price_action', 'technical_indicators'],
        constraints: [],
      },
      plan: {
        taskDisposition: 'analyze',
        primaryIntent: 'Give execution-oriented answers for BTC.',
        subTasks: ['what matters for BTC execution right now'],
        responseMode: 'act',
        requirements: [
          {
            dataType: 'price',
            required: true,
            priority: 'high',
            sourceHint: ['coingecko'],
            reason: 'Price context is required.',
          },
          {
            dataType: 'technical',
            required: true,
            priority: 'high',
            sourceHint: ['coingecko'],
            reason: 'Technical structure is required.',
          },
        ],
        analysisQuestions: ['What matters for execution right now?'],
        openResearch: {
          enabled: true,
          depth: 'standard',
          priority: 'low',
          reason: 'Not needed in this test.',
          topics: [],
          goals: [],
          preferredSources: [],
          mustUseInReport: true,
        },
      },
      execution: {
        identity: {
          symbol: 'BTC',
          chain: 'bitcoin',
          tokenAddress: '',
          sourceId: 'coingecko:bitcoin',
        },
        requestedTypes: ['price'],
        executedTypes: ['price'],
        collectedTypes: ['price'],
        degradedNodes: [],
        missingEvidence: [],
        routing: [],
        asOf: new Date().toISOString(),
        data: {
          market: {
            price: {
              priceUsd: 1,
              change1hPct: 0,
              change24hPct: 0,
              change7dPct: 0,
              change30dPct: 0,
              marketCapRank: 1,
              circulatingSupply: 1,
              totalSupply: 1,
              maxSupply: 1,
              fdvUsd: 1,
              totalVolume24hUsd: 1,
              athUsd: 1,
              atlUsd: 1,
              athChangePct: 0,
              atlChangePct: 0,
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
          openResearch: {
            enabled: false,
            query: '',
            topics: [],
            goals: [],
            preferredSources: [],
            takeaways: [],
            items: [],
            asOf: new Date().toISOString(),
            sourceUsed: [],
            degraded: true,
            degradeReason: 'OPEN_RESEARCH_DISABLED',
          },
          tokenomics: {
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
            degraded: false,
            tokenomicsEvidenceInsufficient: true,
          },
          fundamentals: {
            profile: {
              projectId: null,
              name: 'Bitcoin',
              tokenSymbol: 'BTC',
              oneLiner: null,
              description: null,
              establishmentDate: null,
              active: true,
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
            sourceUsed: [],
            degraded: false,
          },
          technical: {
            rsi: { period: 14, value: 50, signal: 'neutral' },
            macd: { macd: 0, signalLine: 0, histogram: 0, signal: 'neutral' },
            ma: { ma7: 1, ma25: 1, ma99: 1, signal: 'neutral' },
            boll: {
              upper: 1,
              middle: 1,
              lower: 1,
              bandwidth: 0.1,
              signal: 'neutral',
            },
            atr: { value: 1, period: 14 },
            swingHigh: 1,
            swingLow: 1,
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
              degradeReason: 'NOT_AVAILABLE',
            },
          },
          security: {
            isContractOpenSource: null,
            isHoneypot: false,
            isOwnerRenounced: null,
            riskScore: 1,
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
          },
          liquidity: {
            quoteToken: 'USDT',
            hasUsdtOrUsdcPair: true,
            liquidityUsd: 1,
            liquidity1hAgoUsd: null,
            liquidityDrop1hPct: null,
            withdrawalRiskFlag: false,
            volume24hUsd: 1,
            priceImpact1kPct: 0,
            isLpLocked: null,
            lpLockRatioPct: null,
            rugpullRiskSignal: 'low',
            warnings: [],
            asOf: new Date().toISOString(),
            sourceUsed: 'coingecko',
            degraded: false,
          },
          sentiment: {
            socialVolume: 1,
            socialDominance: 1,
            sentimentPositive: 1,
            sentimentNegative: 1,
            sentimentBalanced: 1,
            sentimentScore: 1,
            devActivity: 1,
            githubActivity: 1,
            signal: 'neutral',
            asOf: new Date().toISOString(),
            sourceUsed: 'santiment',
            degraded: false,
          },
        },
      } as any,
      analysis: {
        verdict: 'HOLD',
        confidence: 0.5,
        reason: 'test',
        buyZone: null,
        sellZone: null,
        evidence: ['test'],
        summary: 'test',
        keyObservations: [],
        hardBlocks: [],
        riskHighlights: [],
        opportunityHighlights: [],
        dataQualityNotes: [],
        tradingStrategy: undefined,
      },
      alerts: {
        alertLevel: 'green',
        alertType: [],
        riskState: 'normal',
        redCount: 0,
        yellowCount: 0,
        items: [],
        asOf: new Date().toISOString(),
      },
    });

    expect(capturedUserPrompt).toContain('请只针对 BTC 输出独立分析报告');
    expect(capturedUserPrompt).not.toContain(
      '分析 BTC、ETH 接下来24小时走势，并分别给出策略建议',
    );
  });
});

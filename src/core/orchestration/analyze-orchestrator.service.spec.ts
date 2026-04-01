import { AnalyzeOrchestratorService } from './analyze-orchestrator.service';
import type {
  IntentOutput,
  WorkflowNodeExecutionMeta,
  WorkflowRunResult,
} from '../../data/contracts/workflow-contracts';

describe('AnalyzeOrchestratorService', () => {
  const intent: IntentOutput = {
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
    focusAreas: ['price_action', 'sentiment'],
    constraints: [],
  };

  const intentMeta: WorkflowNodeExecutionMeta = {
    llmStatus: 'success',
    attempts: 1,
    schemaCorrection: false,
    model: 'gpt-5.4',
  };

  const identity = {
    symbol: 'ETH',
    chain: 'ethereum',
    tokenAddress: '0x0000000000000000000000000000000000000000',
    sourceId: 'coingecko:ethereum',
  };

  const pipeline: WorkflowRunResult = {
    identity,
    intent,
    plan: {
      objective: 'market_overview',
      analysisQuestions: ['What is the current market regime?'],
      requirements: [],
      comparisonMode: 'none',
    },
    execution: {
      identity,
      requestedTypes: ['price', 'sentiment'],
      executedTypes: ['price', 'sentiment'],
      collectedTypes: ['price', 'sentiment'],
      degradedNodes: [],
      missingEvidence: [],
      routing: [],
      asOf: new Date().toISOString(),
      data: {
        market: {
          price: {
            priceUsd: 3000,
            change1hPct: 0,
            change24hPct: 1,
            change7dPct: 2,
            change30dPct: 3,
            marketCapRank: 2,
            circulatingSupply: 100,
            totalSupply: 120,
            maxSupply: null,
            fdvUsd: 360000,
            totalVolume24hUsd: 10000,
            athUsd: 4800,
            atlUsd: 0.4,
            athChangePct: -37.5,
            atlChangePct: 749900,
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
          degraded: false,
          tokenomicsEvidenceInsufficient: true,
        },
        fundamentals: {
          profile: {
            projectId: null,
            name: 'Ethereum',
            tokenSymbol: 'ETH',
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
          rsi: { period: 14, value: 52, signal: 'neutral' },
          macd: {
            macd: 1,
            signalLine: 1,
            histogram: 0,
            signal: 'neutral',
          },
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
          isContractOpenSource: true,
          isHoneypot: false,
          isOwnerRenounced: true,
          riskScore: 10,
          riskLevel: 'low',
          riskItems: [],
          canTradeSafely: true,
          holderCount: 10,
          lpHolderCount: 1,
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
          liquidityUsd: 1000000,
          liquidity1hAgoUsd: 1000000,
          liquidityDrop1hPct: 0,
          withdrawalRiskFlag: false,
          volume24hUsd: 500000,
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
          socialVolume: 100,
          socialDominance: 1,
          sentimentPositive: 60,
          sentimentNegative: 40,
          sentimentBalanced: 20,
          sentimentScore: 20,
          devActivity: 10,
          githubActivity: 10,
          signal: 'positive',
          asOf: new Date().toISOString(),
          sourceUsed: 'santiment',
          degraded: false,
        },
      },
    },
    alerts: {
      level: 'medium',
      items: [],
    },
    strategy: {
      verdict: 'HOLD',
      confidence: 0.6,
      reason: 'Neutral setup',
      buyZone: null,
      sellZone: null,
      evidence: ['neutral setup'],
      summary: 'Neutral setup',
    },
    analysis: {
      verdict: 'HOLD',
      confidence: 0.6,
      reason: 'Neutral setup',
      buyZone: null,
      sellZone: null,
      evidence: ['neutral setup'],
      summary: 'Neutral setup',
      keyObservations: [],
      hardBlocks: [],
      riskHighlights: [],
      opportunityHighlights: [],
      dataQualityNotes: [],
      tradingStrategy: {
        bias: 'neutral',
        spotPlan: [],
        derivativesPlan: [],
        riskControls: [],
        invalidation: [],
      },
    },
    report: {
      title: 'ETH report',
      summary: 'Neutral setup',
      body: 'Full report body',
      disclaimer: 'NFA',
    },
    nodeStatus: {
      intent: intentMeta,
      planning: intentMeta,
      analysis: intentMeta,
      report: intentMeta,
    },
  };

  function createService() {
    const searcher = {
      resolveMany: jest.fn(),
      getStatus: jest.fn(() => ({ module: 'searcher', state: 'ready' })),
      resolveCandidateById: jest.fn(),
    };
    const workflow = {
      parseIntentWithMeta: jest.fn(),
      run: jest.fn(),
      getStatus: jest.fn(() => ({ module: 'workflow', state: 'ready' })),
    };
    const intentMemo = {
      get: jest.fn(() => null),
      save: jest.fn(),
    };
    const requestState = {
      set: jest.fn(),
      get: jest.fn(),
      emitEvent: jest.fn(),
      completeEventStream: jest.fn(),
      completeAllEventStreams: jest.fn(),
      stream: jest.fn(),
    };
    const analyzeQueue = {
      enqueue: jest.fn(),
      isQueueEnabled: jest.fn(() => false),
      shutdown: jest.fn(),
    };
    const comparison = {
      shouldBuildComparison: jest.fn(() => false),
      buildComparisonSummary: jest.fn(),
      buildComparisonReport: jest.fn(),
      buildComparisonReportWithMeta: jest.fn(),
      buildMultiTargetBundleReport: jest.fn(),
    };
    const instantChat = {
      reply: jest.fn(),
    };
    const getStatus = (module: string) =>
      jest.fn(() => ({ module, state: 'ready' }));

    const service = new AnalyzeOrchestratorService(
      searcher as any,
      { getStatus: getStatus('market') } as any,
      { getStatus: getStatus('news') } as any,
      { getStatus: getStatus('tokenomics') } as any,
      { getStatus: getStatus('fundamentals') } as any,
      { getStatus: getStatus('technical') } as any,
      { getStatus: getStatus('onchain') } as any,
      { getStatus: getStatus('sentiment') } as any,
      { getStatus: getStatus('security') } as any,
      { getStatus: getStatus('liquidity') } as any,
      { getStatus: getStatus('alerts') } as any,
      { getStatus: getStatus('strategy') } as any,
      { getStatus: getStatus('reporter') } as any,
      workflow as any,
      intentMemo as any,
      requestState as any,
      analyzeQueue as any,
      comparison as any,
      instantChat as any,
    );

    return {
      service,
      searcher,
      workflow,
      intentMemo,
      requestState,
      analyzeQueue,
      comparison,
      instantChat,
    };
  }

  it('bootstrap should accept quickly and enqueue raw request preparation', async () => {
    const { service, searcher, workflow, requestState } = createService();
    const enqueueSpy = jest
      .spyOn(service as any, 'enqueueAnalyzeJob')
      .mockResolvedValue('inline_fallback');

    const response = await service.bootstrap(
      'ETH',
      'deep',
      'en',
      '24h',
      null,
      'thread-1',
    );

    expect(response).toEqual(
      expect.objectContaining({
        status: 'accepted',
        nextAction: 'run_pipeline',
      }),
    );
    expect(workflow.parseIntentWithMeta).not.toHaveBeenCalled();
    expect(searcher.resolveMany).not.toHaveBeenCalled();
    expect(requestState.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        targets: [],
        payload: expect.objectContaining({
          targets: [],
        }),
      }),
    );
    const enqueued = enqueueSpy.mock.calls[0][0];
    expect(enqueued.targets).toEqual([]);
    expect(enqueued.intentHint).toBeUndefined();
    expect(enqueued.intentMeta).toBeUndefined();
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
        threadId: 'thread-1',
        mode: 'deep',
        lang: 'en',
        query: 'ETH',
        timeWindow: '24h',
        preferredChain: null,
        targets: [],
      }),
    );
  });

  it('bootstrap should default to 30d when timeWindow is omitted', async () => {
    const { service } = createService();
    const enqueueSpy = jest
      .spyOn(service as any, 'enqueueAnalyzeJob')
      .mockResolvedValue('inline_fallback');

    await service.bootstrap('ETH', 'deep', 'en');

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'ETH',
        timeWindow: '30d',
      }),
    );
  });

  it('analyzeMessage should create a new request for plain user text', async () => {
    const { service } = createService();
    const bootstrapSpy = jest
      .spyOn(service, 'bootstrap')
      .mockResolvedValue({
        status: 'accepted',
        requestId: 'req-new',
        nextAction: 'run_pipeline',
        message: 'Analyze job accepted and queued for preparation.',
        payload: {
          threadId: 'thread-1',
        },
      });

    const response = await service.analyzeMessage({
      message: '分析 BTC 接下来24小时走势',
      mode: 'deep',
      lang: 'cn',
      requestId: null,
      threadId: 'thread-1',
      timeWindow: '24h',
      preferredChain: null,
    });

    expect(bootstrapSpy).toHaveBeenCalledWith(
      '分析 BTC 接下来24小时走势',
      'deep',
      'cn',
      '24h',
      null,
      'thread-1',
    );
    expect(response).toEqual(
      expect.objectContaining({
        status: 'accepted',
        requestId: 'req-new',
        threadId: 'thread-1',
        mode: 'created',
        nextAction: 'run_pipeline',
      }),
    );
  });

  it('analyzeMessage should auto-create thread id for first message when missing', async () => {
    const { service } = createService();
    const bootstrapSpy = jest
      .spyOn(service, 'bootstrap')
      .mockResolvedValue({
        status: 'accepted',
        requestId: 'req-new',
        nextAction: 'run_pipeline',
        message: 'Analyze job accepted and queued for preparation.',
      });

    const response = await service.analyzeMessage({
      message: '分析 BTC',
      mode: 'deep',
      lang: 'cn',
      requestId: null,
      threadId: null,
      timeWindow: '24h',
      preferredChain: null,
    });

    expect(bootstrapSpy).toHaveBeenCalledWith(
      '分析 BTC',
      'deep',
      'cn',
      '24h',
      null,
      expect.any(String),
    );
    expect(response.threadId).toEqual(expect.any(String));
    expect(response.threadId).not.toBe('');
  });

  it('analyzeMessage should continue waiting selection when reply matches candidate', async () => {
    const { service, requestState } = createService();
    const selectSpy = jest.spyOn(service, 'select').mockResolvedValue({
      status: 'accepted',
      requestId: 'req-select',
      nextAction: 'selection_recorded',
      message: 'Selection accepted.',
    });

    requestState.get.mockResolvedValue({
      requestId: 'req-select',
      status: 'waiting_selection',
      threadId: 'thread-1',
      lang: 'cn',
      query: '分析 polygon',
      timeWindow: '24h',
      preferredChain: null,
      targets: [
        {
          targetKey: 'PRIMARY',
          targetQuery: 'polygon',
          status: 'waiting_selection',
          candidates: [
            {
              candidateId: 'cand-polygon-matic',
              symbol: 'MATIC',
              chain: 'polygon',
              tokenName: 'Polygon',
              tokenAddress: '',
              quoteToken: 'OTHER',
              sourceId: 'coingecko:matic-network',
            },
            {
              candidateId: 'cand-polygon-pol',
              symbol: 'POL',
              chain: 'polygon',
              tokenName: 'POL',
              tokenAddress: '',
              quoteToken: 'OTHER',
              sourceId: 'coingecko:matic-network',
            },
          ],
        },
      ],
      candidates: [
        {
          candidateId: 'cand-polygon-matic',
          symbol: 'MATIC',
          chain: 'polygon',
          tokenName: 'Polygon',
          tokenAddress: '',
          quoteToken: 'OTHER',
          sourceId: 'coingecko:matic-network',
          targetKey: 'PRIMARY',
        },
        {
          candidateId: 'cand-polygon-pol',
          symbol: 'POL',
          chain: 'polygon',
          tokenName: 'POL',
          tokenAddress: '',
          quoteToken: 'OTHER',
          sourceId: 'coingecko:matic-network',
          targetKey: 'PRIMARY',
        },
      ],
      payload: {},
    });

    const response = await service.analyzeMessage({
      message: '选 MATIC',
      mode: 'deep',
      lang: 'cn',
      requestId: 'req-select',
      threadId: 'thread-1',
      timeWindow: '24h',
      preferredChain: null,
    });

    expect(selectSpy).toHaveBeenCalledWith(
      'req-select',
      'cand-polygon-matic',
      'PRIMARY',
    );
    expect(response).toEqual(
      expect.objectContaining({
        status: 'accepted',
        requestId: 'req-select',
        threadId: 'thread-1',
        mode: 'continued',
        nextAction: 'selection_recorded',
      }),
    );
  });

  it('select should resolve candidate from request state even when searcher registry is empty', async () => {
    const { service, requestState, searcher } = createService();
    searcher.resolveCandidateById.mockReturnValue(null);
    jest
      .spyOn(service as any, 'enqueueAnalyzeJob')
      .mockResolvedValue('inline_fallback');

    requestState.get.mockResolvedValue({
      requestId: 'req-select',
      status: 'waiting_selection',
      threadId: 'thread-1',
      query: '分析 polygon',
      timeWindow: '24h',
      preferredChain: null,
      targets: [
        {
          targetKey: 'PRIMARY',
          targetQuery: 'polygon',
          status: 'waiting_selection',
          candidates: [
            {
              candidateId: 'cand-polygon-matic',
              symbol: 'MATIC',
              chain: 'polygon',
              tokenName: 'Polygon',
              tokenAddress: '',
              quoteToken: 'OTHER',
              sourceId: 'coingecko:matic-network',
            },
          ],
        },
      ],
      candidates: [
        {
          candidateId: 'cand-polygon-matic',
          symbol: 'MATIC',
          chain: 'polygon',
          tokenName: 'Polygon',
          tokenAddress: '',
          quoteToken: 'OTHER',
          sourceId: 'coingecko:matic-network',
          targetKey: 'PRIMARY',
        },
      ],
      payload: {},
    });

    const response = await service.select(
      'req-select',
      'cand-polygon-matic',
      'PRIMARY',
    );

    expect(response).toEqual(
      expect.objectContaining({
        status: 'accepted',
        requestId: 'req-select',
        nextAction: 'selection_recorded',
      }),
    );
    expect(requestState.set).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          symbol: 'MATIC',
          chain: 'polygon',
          sourceId: 'coingecko:matic-network',
        }),
      }),
    );
  });

  it('analyzeMessage should create a new request when waiting selection gets a new question', async () => {
    const { service, requestState } = createService();
    const bootstrapSpy = jest
      .spyOn(service, 'bootstrap')
      .mockResolvedValue({
        status: 'accepted',
        requestId: 'req-follow-up',
        nextAction: 'run_pipeline',
        message: 'Analyze job accepted and queued for preparation.',
      });

    requestState.get.mockResolvedValue({
      requestId: 'req-select',
      status: 'waiting_selection',
      threadId: 'thread-1',
      lang: 'cn',
      query: '分析 polygon',
      timeWindow: '7d',
      preferredChain: 'polygon',
      targets: [
        {
          targetKey: 'PRIMARY',
          targetQuery: 'polygon',
          status: 'waiting_selection',
          candidates: [
            {
              candidateId: 'cand-polygon-matic',
              symbol: 'MATIC',
              chain: 'polygon',
              tokenName: 'Polygon',
              tokenAddress: '',
              quoteToken: 'OTHER',
              sourceId: 'coingecko:matic-network',
            },
          ],
        },
      ],
      candidates: [
        {
          candidateId: 'cand-polygon-matic',
          symbol: 'MATIC',
          chain: 'polygon',
          tokenName: 'Polygon',
          tokenAddress: '',
          quoteToken: 'OTHER',
          sourceId: 'coingecko:matic-network',
          targetKey: 'PRIMARY',
        },
      ],
      payload: {},
    });

    const response = await service.analyzeMessage({
      message: '那改成分析 ETH 吧',
      mode: 'deep',
      lang: 'cn',
      requestId: 'req-select',
      threadId: 'thread-1',
      timeWindow: '24h',
      preferredChain: null,
    });

    expect(bootstrapSpy).toHaveBeenCalledWith(
      '那改成分析 ETH 吧',
      'deep',
      'cn',
      '7d',
      'polygon',
      'thread-1',
    );
    expect(response).toEqual(
      expect.objectContaining({
        status: 'accepted',
        requestId: 'req-follow-up',
        threadId: 'thread-1',
        mode: 'created',
        nextAction: 'run_pipeline',
      }),
    );
  });

  it('processAnalyzeJob should parse intent and resolve targets when bootstrap queued a raw request', async () => {
    const { service, searcher, workflow, requestState, comparison } =
      createService();

    workflow.parseIntentWithMeta.mockResolvedValue({
      intent,
      meta: intentMeta,
    });
    searcher.resolveMany.mockResolvedValue([
      {
        targetKey: 'ETH',
        targetQuery: 'ETH',
        result: {
          kind: 'resolved',
          identity,
        },
      },
    ]);
    workflow.run.mockResolvedValue(pipeline);
    requestState.get
      .mockResolvedValueOnce({
        requestId: 'req-raw',
        status: 'pending',
        threadId: 'thread-1',
        query: 'ETH',
        timeWindow: '24h',
        preferredChain: null,
        targets: [],
        candidates: [],
        payload: {},
      })
      .mockResolvedValueOnce({
        requestId: 'req-raw',
        status: 'pending',
        threadId: 'thread-1',
        query: 'ETH',
        timeWindow: '24h',
        preferredChain: null,
        targets: [],
        candidates: [],
        payload: {},
      });

    await (service as any).processAnalyzeJob({
      requestId: 'req-raw',
      threadId: 'thread-1',
      query: 'ETH',
      timeWindow: '24h',
      preferredChain: null,
      targets: [],
    });

    expect(workflow.parseIntentWithMeta).toHaveBeenCalledTimes(1);
    expect(searcher.resolveMany).toHaveBeenCalledWith('ETH', null, {
      objective: intent.objective,
      taskType: intent.taskType,
      entities: intent.entities,
      entityMentions: intent.entityMentions,
      chains: intent.chains,
    });
    expect(workflow.run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'ETH',
        intent,
        intentMeta,
        identity,
      }),
      expect.any(Object),
    );
    expect(
      requestState.set.mock.calls.some(
        ([request]) => request?.status === 'ready',
      ),
    ).toBe(true);
    expect(comparison.shouldBuildComparison).toHaveBeenCalledWith(intent, 1);
  });

  it('processAnalyzeJob should reuse queued intent and pass intent meta into workflow execution', async () => {
    const { service, workflow, requestState, intentMemo, comparison } =
      createService();

    workflow.run.mockResolvedValue(pipeline);
    requestState.get
      .mockResolvedValueOnce({
        requestId: 'req-1',
        status: 'pending',
        threadId: 'thread-1',
        query: 'ETH',
        timeWindow: '24h',
        preferredChain: null,
        targets: [],
        candidates: [],
        intentHint: intent,
        intentMeta,
        payload: {},
      })
      .mockResolvedValueOnce({
        requestId: 'req-1',
        status: 'pending',
        threadId: 'thread-1',
        query: 'ETH',
        timeWindow: '24h',
        preferredChain: null,
        targets: [],
        candidates: [],
        intentHint: intent,
        intentMeta,
        payload: {},
      });

    await (service as any).processAnalyzeJob({
      requestId: 'req-1',
      threadId: 'thread-1',
      query: 'ETH',
      timeWindow: '24h',
      preferredChain: null,
      targets: [
        {
          targetKey: 'ETH',
          identity,
        },
      ],
      intentHint: intent,
      intentMeta,
    });

    expect(workflow.parseIntentWithMeta).not.toHaveBeenCalled();
    expect(workflow.run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'ETH',
        intent,
        intentMeta,
        identity,
      }),
      expect.any(Object),
    );
    expect(requestState.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        payload: expect.objectContaining({
          intent,
          nodeStatus: expect.objectContaining({
            intent: intentMeta,
          }),
        }),
      }),
    );
    expect(intentMemo.save).toHaveBeenCalled();
    expect(comparison.shouldBuildComparison).toHaveBeenCalledWith(intent, 1);
  });

  it('processAnalyzeJob should expose only final comparison report payload in comparison mode', async () => {
    const { service, workflow, requestState, comparison } = createService();
    const comparisonIntent: IntentOutput = {
      ...intent,
      userQuery: 'Compare BTC vs ETH',
      taskType: 'comparison',
      outputGoal: 'comparison',
      entities: ['BTC', 'ETH'],
      entityMentions: ['BTC', 'ETH'],
      symbols: ['BTC', 'ETH'],
      chains: ['bitcoin', 'ethereum'],
      timeWindow: '7d',
    };
    const btcIdentity = {
      symbol: 'BTC',
      chain: 'bitcoin',
      tokenAddress: '',
      sourceId: 'coingecko:bitcoin',
    };
    const ethIdentity = {
      symbol: 'ETH',
      chain: 'ethereum',
      tokenAddress: '',
      sourceId: 'coingecko:ethereum',
    };
    const btcPipeline: WorkflowRunResult = {
      ...pipeline,
      identity: btcIdentity,
      intent: comparisonIntent,
      execution: {
        ...pipeline.execution,
        identity: btcIdentity,
      },
      report: {
        ...pipeline.report,
        title: 'BTC report',
      },
      nodeStatus: {
        ...pipeline.nodeStatus,
        report: {
          llmStatus: 'skipped',
          attempts: 0,
          schemaCorrection: false,
          model: null,
          failureReason: 'comparison_mode_skip',
        },
      },
    };
    const ethPipeline: WorkflowRunResult = {
      ...pipeline,
      identity: ethIdentity,
      intent: comparisonIntent,
      execution: {
        ...pipeline.execution,
        identity: ethIdentity,
      },
      report: {
        ...pipeline.report,
        title: 'ETH report',
      },
      nodeStatus: {
        ...pipeline.nodeStatus,
        report: {
          llmStatus: 'skipped',
          attempts: 0,
          schemaCorrection: false,
          model: null,
          failureReason: 'comparison_mode_skip',
        },
      },
    };
    const comparisonSummary = {
      winner: {
        targetKey: 'BTC',
        symbol: 'BTC',
        chain: 'bitcoin',
        verdict: 'HOLD',
        confidence: 0.6,
        score: 12,
        reasons: ['analysis=HOLD'],
      },
      ranked: [],
      summary: 'BTC leads',
    };
    const comparisonReport = {
      ...pipeline.report,
      title: 'Final comparison report',
      body: '## Final comparison body',
    };

    workflow.parseIntentWithMeta.mockResolvedValue({
      intent: comparisonIntent,
      meta: intentMeta,
    });
    workflow.run
      .mockResolvedValueOnce(btcPipeline)
      .mockResolvedValueOnce(ethPipeline);
    comparison.shouldBuildComparison.mockReturnValue(true);
    comparison.buildComparisonSummary.mockReturnValue(comparisonSummary);
    comparison.buildComparisonReportWithMeta.mockResolvedValue({
      report: comparisonReport,
      meta: {
        llmStatus: 'success',
        attempts: 1,
        schemaCorrection: false,
        model: 'gpt-5.4',
      },
    });
    requestState.get
      .mockResolvedValueOnce({
        requestId: 'req-cmp',
        status: 'pending',
        threadId: null,
        query: 'Compare BTC vs ETH',
        timeWindow: '7d',
        preferredChain: null,
        targets: [],
        candidates: [],
        payload: {},
      })
      .mockResolvedValueOnce({
        requestId: 'req-cmp',
        status: 'pending',
        threadId: null,
        query: 'Compare BTC vs ETH',
        timeWindow: '7d',
        preferredChain: null,
        targets: [],
        candidates: [],
        payload: {},
      });

    await (service as any).processAnalyzeJob({
      requestId: 'req-cmp',
      threadId: null,
      query: 'Compare BTC vs ETH',
      timeWindow: '7d',
      preferredChain: null,
      targets: [
        { targetKey: 'BTC', identity: btcIdentity },
        { targetKey: 'ETH', identity: ethIdentity },
      ],
    });

    expect(workflow.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        identity: btcIdentity,
        renderPerTargetReport: false,
      }),
      expect.any(Object),
    );
    expect(workflow.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identity: ethIdentity,
        renderPerTargetReport: false,
      }),
      expect.any(Object),
    );
    expect(requestState.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        payload: expect.objectContaining({
          report: expect.objectContaining({
            title: 'Final comparison report',
          }),
          targetPipelines: [],
          comparison: expect.objectContaining({
            summary: 'BTC leads',
            report: expect.objectContaining({
              title: 'Final comparison report',
            }),
            meta: expect.objectContaining({
              llmStatus: 'success',
            }),
          }),
        }),
      }),
    );
  });
});

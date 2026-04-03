import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { AlertsSnapshot } from '../../../data/contracts/analyze-contracts';
import {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
  PlanResponseMode,
  ReportMeta,
  ReportOutput,
  WorkflowNodeExecutionMeta,
} from '../../../data/contracts/workflow-contracts';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { buildReportPrompts } from '../prompts';
import type { ReportPromptContext } from '../prompts';

const reportNarrativeSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string().min(1),
  body: z.string().min(1),
  disclaimer: z.string().min(1),
});

type ReportNarrative = z.infer<typeof reportNarrativeSchema>;

type RenderReportInput = {
  intent: IntentOutput;
  plan: PlanOutput;
  execution: ExecutionOutput;
  analysis: AnalysisOutput;
  alerts: AlertsSnapshot;
  conversationHistoryRaw: string | null;
};

@Injectable()
export class ReportNodeService {
  private readonly logger = new Logger(ReportNodeService.name);
  private readonly hiddenReportPatterns = [
    /证据不足/,
    /数据不足/,
    /数据缺失/,
    /缺失证据/,
    /数据降级/,
    /降级节点/,
    /degraded/i,
    /core evidence/i,
    /evidence\s+is\s+incomplete/i,
    /missing evidence/i,
    /data quality/i,
    /incomplete evidence/i,
    /insufficient data/i,
  ];

  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  buildDeterministicOnly(input: RenderReportInput): ReportOutput {
    return this.buildDeterministicReport(input);
  }

  buildTaskDispositionOnly(input: {
    intent: IntentOutput;
    plan: PlanOutput;
    symbol: string;
  }): ReportOutput {
    const isZh = input.intent.language === 'zh';
    const title =
      input.plan.taskDisposition === 'clarify'
        ? isZh
          ? '需要先澄清你的任务'
          : 'Clarification Needed Before Analysis'
        : input.plan.taskDisposition === 'non_analysis'
          ? isZh
            ? '这不是一个适合直接走币种分析流的问题'
            : 'This Request Should Not Go Through The Asset Analysis Flow'
          : isZh
            ? '当前请求不适合继续处理'
            : 'This Request Cannot Be Processed Normally';

    const executiveSummary =
      input.plan.taskDisposition === 'clarify'
        ? isZh
          ? `当前更适合先澄清你的真正目标，再决定是否进入 ${input.symbol} 的分析流程。`
          : `It is better to clarify your real goal before deciding whether to enter the ${input.symbol} analysis workflow.`
        : input.plan.taskDisposition === 'non_analysis'
          ? isZh
            ? '当前请求更像是非币种研究任务，因此不应直接进入标准分析流。'
            : 'This request looks more like a non-research task, so it should not enter the standard asset-analysis flow.'
          : isZh
            ? '当前请求不适合按正常分析任务继续处理。'
            : 'This request should not continue as a normal analysis task.';

    const points =
      input.plan.taskDisposition === 'clarify'
        ? [
            isZh
              ? `系统识别到你的主目标是：${input.plan.primaryIntent}`
              : `Detected primary intent: ${input.plan.primaryIntent}`,
            isZh
              ? `在进入分析前，需要先确认：${input.plan.subTasks.join('；')}`
              : `Before analysis, please clarify: ${input.plan.subTasks.join('; ')}`,
          ]
        : [
            isZh
              ? `系统识别到你的主目标是：${input.plan.primaryIntent}`
              : `Detected primary intent: ${input.plan.primaryIntent}`,
            isZh
              ? '这个请求更适合走其他类型的回答路径，而不是币种研究报告。'
              : 'This request is better handled through another response path instead of an asset research report.',
          ];

    const sections = [
      {
        heading: isZh ? '核心结论' : 'Core Answer',
        points,
      },
    ];
    const body = [
      `# ${title}`,
      '',
      `## ${isZh ? '核心结论' : 'Core Answer'}`,
      ...points.map((point) => `- ${point}`),
      '',
      isZh
        ? '本回复用于任务分流，不构成投资建议。'
        : 'This response is for task routing only and does not constitute investment advice.',
    ].join('\n');

    return {
      title,
      executiveSummary,
      body,
      sections,
      reportMeta: {
        keyTakeaway: points[0],
        whyNow: points.slice(1),
        actionGuidance: [],
        keyTriggers: [],
        invalidationSignals: [],
        dataQualityNotes: [],
        scenarioMap: [],
      },
      verdict: 'INSUFFICIENT_DATA',
      confidence: 0,
      disclaimer: isZh
        ? '本回复用于任务分流，不构成投资建议。'
        : 'This response is for task routing only and does not constitute investment advice.',
    };
  }

  async render(input: RenderReportInput): Promise<ReportOutput> {
    const result = await this.renderWithMeta(input);
    return result.report;
  }

  async renderWithMeta(input: RenderReportInput): Promise<{
    report: ReportOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    const fallback = this.buildDeterministicReport(input);
    const { execution } = input;
    const plan = input.plan ?? {
      taskDisposition: 'analyze' as const,
      primaryIntent: 'Produce a crypto research report for the current target.',
      subTasks: ['Explain what matters most for the current target.'],
      responseMode: this.inferResponseMode(input.intent),
      requirements: [],
      analysisQuestions: [
        'What is the user actually asking and what evidence matters most?',
      ],
      openResearch: {
        enabled: true,
        depth: 'standard' as const,
        priority: 'low' as const,
        reason: 'Plan input missing at render time.',
        topics: [],
        goals: [],
        preferredSources: [],
        mustUseInReport: true,
      },
    };
    const scopedQuery = this.buildScopedQuery(
      input.intent,
      execution.identity.symbol,
    );

    const price = execution.data.market.price;
    const technical = execution.data.technical;
    const onchain = execution.data.onchain.cexNetflow;
    const security = execution.data.security;
    const liquidity = execution.data.liquidity;
    const openResearch = execution.data.openResearch ?? {
      enabled: false,
      query: '',
      topics: [],
      goals: [],
      preferredSources: [],
      takeaways: [],
      items: [],
      asOf: execution.asOf,
      sourceUsed: [],
      degraded: true,
      degradeReason: 'OPEN_RESEARCH_MISSING_AT_RENDER_TIME',
    };
    const tokenomics = execution.data.tokenomics;
    const tokenomicsBurns = tokenomics.burns ?? {
      totalBurnAmount: null,
      recentBurns: [],
    };
    const tokenomicsBuybacks = tokenomics.buybacks ?? {
      totalBuybackAmount: null,
      recentBuybacks: [],
    };
    const tokenomicsFundraising = tokenomics.fundraising ?? {
      totalRaised: null,
      rounds: [],
    };
    const fundamentals = execution.data.fundamentals;
    const sentiment = execution.data.sentiment;

    const context: ReportPromptContext = {
      language: input.intent.language,
      query: scopedQuery,
      taskType: input.intent.taskType,
      objective: input.intent.objective,
      sentimentBias: input.intent.sentimentBias,
      entities: input.intent.entities,
      focusAreas: input.intent.focusAreas,
      conversationHistoryRaw: input.conversationHistoryRaw,
      planning: {
        taskDisposition: plan.taskDisposition,
        primaryIntent: plan.primaryIntent,
        subTasks: plan.subTasks,
        responseMode: plan.responseMode,
        requiredModules: plan.requirements
          .filter((item) => item.required)
          .map((item) => ({
            dataType: item.dataType,
            priority: item.priority,
            reason: item.reason,
          })),
        analysisQuestions: plan.analysisQuestions,
        openResearch: plan.openResearch,
      },
      target: {
        symbol: execution.identity.symbol,
        chain: execution.identity.chain,
        tokenAddress: execution.identity.tokenAddress,
      },
      market: {
        priceUsd: price.priceUsd,
        change24hPct: price.change24hPct,
        change7dPct: price.change7dPct,
        volume24hUsd: price.totalVolume24hUsd,
        marketCapRank: price.marketCapRank,
        marketCapUsd: price.marketCapUsd ?? null,
        fdvUsd: price.fdvUsd,
        circulatingSupply: price.circulatingSupply,
        maxSupply: price.maxSupply,
      },
      recentEvidence: {
        news: execution.data.news.items.map((item) => ({
          title: item.title,
          source: item.source,
          publishedAt: item.publishedAt,
          category: item.category,
          relevanceScore: item.relevanceScore,
          url: item.url,
        })),
        openResearch: {
          enabled: openResearch.enabled,
          depth: plan.openResearch.depth,
          mustUseInReport: plan.openResearch.mustUseInReport,
          goals: openResearch.goals,
          topics: openResearch.topics,
          takeaways: openResearch.takeaways,
          items: openResearch.items.map((item) => ({
            title: item.title,
            source: item.source,
            topic: item.topic,
            snippet: item.snippet,
            url: item.url,
          })),
        },
      },
      signals: {
        technical: technical.summarySignal,
        technicalDetails: {
          rsi: { value: technical.rsi.value, signal: technical.rsi.signal },
          macd: {
            value: technical.macd.macd,
            signal: technical.macd.signal,
            histogram: technical.macd.histogram,
          },
          ma: {
            ma7: technical.ma.ma7,
            ma25: technical.ma.ma25,
            ma99: technical.ma.ma99,
            signal: technical.ma.signal,
          },
          boll: {
            upper: technical.boll.upper,
            middle: technical.boll.middle,
            lower: technical.boll.lower,
            signal: technical.boll.signal,
          },
          atr: technical.atr.value,
          swingHigh: technical.swingHigh,
          swingLow: technical.swingLow,
        },
        onchain: onchain.signal,
        sentiment: sentiment.signal,
        sentimentDetails: {
          socialVolume: sentiment.socialVolume,
          sentimentScore: sentiment.sentimentScore,
          sentimentPositive: sentiment.sentimentPositive,
          sentimentNegative: sentiment.sentimentNegative,
          devActivity: sentiment.devActivity,
        },
        securityRisk: security.riskLevel,
        liquidityUsd: liquidity.liquidityUsd,
        liquidityDetails: {
          volume24hUsd: liquidity.volume24hUsd,
          liquidityDrop1hPct: liquidity.liquidityDrop1hPct,
          priceImpact1kPct: liquidity.priceImpact1kPct,
          rugpullRiskSignal: liquidity.rugpullRiskSignal,
          topVenues: liquidity.topVenues ?? [],
          venueCount: liquidity.venueCount ?? null,
        },
        inflationRate: tokenomics.inflationRate.currentAnnualPct,
        projectName: fundamentals.profile.name,
        projectOneLiner: fundamentals.profile.oneLiner,
        fundamentalsTags: fundamentals.profile.tags,
      },
      fundamentals: {
        totalFundingUsd: fundamentals.profile.totalFundingUsd,
        rtScore: fundamentals.profile.rtScore,
        tvlScore: fundamentals.profile.tvlScore,
        investorCount: fundamentals.investors.length,
        topInvestors: fundamentals.investors.map((item) => item.name).slice(0, 5),
        fundraisingCount: fundamentals.fundraising.length,
        latestRound:
          fundamentals.fundraising.length > 0
            ? {
                round: fundamentals.fundraising[0]?.round ?? null,
                amountUsd: fundamentals.fundraising[0]?.amountUsd ?? null,
                publishedAt: fundamentals.fundraising[0]?.publishedAt ?? null,
                investors: fundamentals.fundraising[0]?.investors ?? [],
              }
            : null,
        ecosystemCount:
          fundamentals.ecosystems.ecosystems.length +
          fundamentals.ecosystems.onMainNet.length +
          fundamentals.ecosystems.onTestNet.length +
          fundamentals.ecosystems.planToLaunch.length,
        ecosystemHighlights: [
          ...fundamentals.ecosystems.ecosystems,
          ...fundamentals.ecosystems.onMainNet,
          ...fundamentals.ecosystems.onTestNet,
          ...fundamentals.ecosystems.planToLaunch,
        ].slice(0, 6),
        socialFollowers: fundamentals.social.followers,
        hotIndexScore: fundamentals.social.hotIndexScore,
        socialLinks: fundamentals.social.socialLinks,
      },
      decision: {
        verdict: input.analysis.verdict,
        confidence: input.analysis.confidence,
        reason: this.toVisibleReason(
          input.analysis,
          input.intent.language === 'zh',
        ),
        buyZone: input.analysis.buyZone,
        sellZone: input.analysis.sellZone,
        evidence: this.filterUserVisibleItems(input.analysis.evidence),
        hardBlocks: input.analysis.hardBlocks,
        tradingStrategy: input.analysis.tradingStrategy,
      },
      insights: {
        summary: this.toVisibleSummary(
          input.analysis,
          execution,
          input.intent.language === 'zh',
        ),
        keyObservations: this.filterUserVisibleItems(
          input.analysis.keyObservations,
        ),
        riskHighlights: this.filterUserVisibleItems(
          input.analysis.riskHighlights,
        ),
        opportunityHighlights: input.analysis.opportunityHighlights,
      },
      alerts: {
        level: input.alerts.alertLevel,
        riskState: input.alerts.riskState,
        redCount: this.filterUserVisibleAlerts(input.alerts).redCount,
        yellowCount: this.filterUserVisibleAlerts(input.alerts).yellowCount,
        topItems: this.filterUserVisibleAlerts(input.alerts)
          .items.slice(0, 5)
          .map(
            (item) =>
              `[${item.severity.toUpperCase()}] ${item.code}: ${item.message}`,
          ),
      },
      anomalies: {
        priceVolatility: this.detectPriceAnomaly(
          price,
          input.intent.language === 'zh',
        ),
        socialActivity: this.detectSocialAnomaly(
          sentiment,
          input.intent.language === 'zh',
        ),
        onchainFlow: this.detectOnchainAnomaly(
          onchain,
          input.intent.language === 'zh',
        ),
        riskEscalation: this.detectRiskEscalation(
          input.alerts,
          input.intent.language === 'zh',
        ),
      },
      tokenomics: {
        burns: {
          totalBurnAmount: tokenomicsBurns.totalBurnAmount,
          recentBurnCount: tokenomicsBurns.recentBurns.length,
          latestBurnDate: tokenomicsBurns.recentBurns[0]?.burnDate ?? null,
          burnSummary: this.buildBurnSummary(
            tokenomicsBurns,
            input.intent.language === 'zh',
          ),
        },
        buybacks: {
          totalBuybackAmount: tokenomicsBuybacks.totalBuybackAmount,
          recentBuybackCount: tokenomicsBuybacks.recentBuybacks.length,
          latestBuybackDate:
            tokenomicsBuybacks.recentBuybacks[0]?.buybackDate ?? null,
          buybackSummary: this.buildBuybackSummary(
            tokenomicsBuybacks,
            input.intent.language === 'zh',
          ),
        },
        fundraising: {
          totalRaised: tokenomicsFundraising.totalRaised,
          roundCount: tokenomicsFundraising.rounds.length,
          latestRoundDate: tokenomicsFundraising.rounds[0]?.fundingDate ?? null,
          fundraisingSummary: this.buildFundraisingSummary(
            tokenomicsFundraising,
            input.intent.language === 'zh',
          ),
        },
      },
    };
    const prompts = buildReportPrompts(context);

    const narrative = await this.llmRuntime.generateStructuredWithMeta({
      nodeName: 'report',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: reportNarrativeSchema,
      fallback: () => this.toNarrativeFallback(fallback),
    });

    const finalizedReport = this.finalizeReport(
      this.composeReport(narrative.data, fallback, input),
      input,
    );
    this.auditStructuredDataCoverage(finalizedReport, input);

    return {
      report: finalizedReport,
      meta: narrative.meta,
    };
  }

  private buildScopedQuery(intent: IntentOutput, symbol: string): string {
    if (intent.taskType !== 'multi_asset') {
      return intent.userQuery;
    }

    return intent.language === 'zh'
      ? `请只针对 ${symbol} 输出独立分析报告，不要比较、排序，也不要提及其他标的。`
      : `Produce an independent report only for ${symbol}. Do not compare, rank, or mention other assets.`;
  }

  private buildDeterministicReport(input: RenderReportInput): ReportOutput {
    const responseMode =
      input.plan?.responseMode ?? this.inferResponseMode(input.intent);

    if (responseMode === 'act') {
      return this.buildActionReport(input, responseMode);
    }

    return this.buildExplainOrAssessReport(input, responseMode);
  }

  private buildExplainOrAssessReport(
    input: RenderReportInput,
    responseMode: Extract<PlanResponseMode, 'explain' | 'assess'>,
  ): ReportOutput {
    const isZh = input.intent.language === 'zh';
    const { execution, analysis, alerts } = input;
    const price = execution.data.market.price;
    const security = execution.data.security;
    const liquidity = execution.data.liquidity;
    const onchain = execution.data.onchain.cexNetflow;
    const technical = execution.data.technical;
    const tokenomics = execution.data.tokenomics;
    const fundamentals = execution.data.fundamentals;
    const news = execution.data.news;
    const openResearch = execution.data.openResearch;
    const sentiment = execution.data.sentiment;
    const userVisibleAlerts = this.filterUserVisibleAlerts(alerts);
    const visibleReason = this.toVisibleReason(analysis, isZh);
    const visibleEvidence = this.filterUserVisibleItems(analysis.evidence);
    const symbol = execution.identity.symbol;
    const confidence = analysis.confidence ?? 0;
    const verdictLabel = this.toVisibleVerdictLabel(analysis.verdict, isZh);

    const title =
      responseMode === 'explain'
        ? isZh
          ? `${symbol} 解读：现在最值得关注的结论`
          : `${symbol} Explained: What Matters Most Now`
        : isZh
          ? `${symbol} 投资判断：现在该怎么理解`
          : `${symbol} Investment View: How To Read It Now`;

    const executiveSummary =
      responseMode === 'explain'
        ? [
            visibleReason,
            isZh
              ? `${symbol} 更适合用“解释发生了什么”的方式来理解，而不是直接套用交易计划。当前判断置信度 ${(confidence * 100).toFixed(0)}%。`
              : `${symbol} is better understood through an explanatory lens than a trade setup right now. Current confidence is ${(confidence * 100).toFixed(0)}%.`,
          ].join('\n')
        : [
            visibleReason,
            isZh
              ? `${symbol} 当前更适合按「${verdictLabel}」来理解其投资吸引力，但重点在理由和风险，不在短线操作。当前判断置信度 ${(confidence * 100).toFixed(0)}%。`
              : `${symbol} is currently best read as "${verdictLabel}" from an investment perspective, with the emphasis on reasons and risks rather than short-term execution. Current confidence is ${(confidence * 100).toFixed(0)}%.`,
          ].join('\n');

    const keySignals: string[] = [];
    keySignals.push(
      responseMode === 'explain'
        ? isZh
          ? `如果只看一个结论：${visibleReason}`
          : `If you only keep one takeaway: ${visibleReason}`
        : isZh
          ? `当前更适合把 ${symbol} 理解为「${verdictLabel}」，核心原因是：${visibleReason}`
          : `${symbol} is best read as "${verdictLabel}" right now because ${visibleReason}`,
    );
    if (visibleEvidence.length > 0) {
      keySignals.push(
        responseMode === 'explain'
          ? isZh
            ? `最值得优先看的证据是：${visibleEvidence.slice(0, 2).join('；')}`
            : `The most useful evidence to start with is: ${visibleEvidence.slice(0, 2).join('; ')}`
          : isZh
            ? `支撑当前判断的核心理由是：${visibleEvidence.slice(0, 2).join('；')}`
            : `The core reasons supporting this view are: ${visibleEvidence.slice(0, 2).join('; ')}`,
      );
    }

    const whyNowPoints: string[] = [];
    const marketLine = this.buildMarketContextLine(price, isZh);
    if (marketLine) {
      whyNowPoints.push(marketLine);
    }
    const recentEvidenceLine = this.buildRecentEvidenceLine(
      execution,
      responseMode,
      isZh,
    );
    if (recentEvidenceLine) {
      whyNowPoints.push(recentEvidenceLine);
    }
    if (fundamentals.profile.name || fundamentals.profile.oneLiner) {
      whyNowPoints.push(
        responseMode === 'explain'
          ? isZh
            ? `从基本面看，${fundamentals.profile.name ?? symbol}${fundamentals.profile.oneLiner ? ` 可以概括为「${fundamentals.profile.oneLiner}」` : ''}，这决定了市场为什么愿意继续讨论它。`
            : `From a fundamentals angle, ${fundamentals.profile.name ?? symbol}${fundamentals.profile.oneLiner ? ` can be summarized as "${fundamentals.profile.oneLiner}"` : ''}, which helps explain why the market still pays attention to it.`
          : isZh
            ? `从基本面看，${fundamentals.profile.name ?? symbol}${fundamentals.profile.oneLiner ? ` 的核心定位仍是「${fundamentals.profile.oneLiner}」` : ''}，这是投资判断能否成立的底层前提。`
            : `From a fundamentals angle, ${fundamentals.profile.name ?? symbol}${fundamentals.profile.oneLiner ? ` still centers on "${fundamentals.profile.oneLiner}"` : ''}, which is a core condition for the investment thesis to hold.`,
      );
    }
    if (tokenomics.inflationRate.currentAnnualPct !== null) {
      whyNowPoints.push(
        responseMode === 'explain'
          ? isZh
            ? `代币经济方面，当前年化通胀约 ${tokenomics.inflationRate.currentAnnualPct.toFixed(2)}%，至少从已知数据看，没有出现明显失控的稀释信号。`
            : `On tokenomics, current annual inflation is about ${tokenomics.inflationRate.currentAnnualPct.toFixed(2)}%, which does not point to obviously uncontrolled dilution from the available evidence.`
          : isZh
            ? `代币经济方面，当前年化通胀约 ${tokenomics.inflationRate.currentAnnualPct.toFixed(2)}%，这会直接影响中长期投资回报的可持续性。`
            : `On tokenomics, current annual inflation is about ${tokenomics.inflationRate.currentAnnualPct.toFixed(2)}%, which directly affects how sustainable the investment case may be over time.`,
      );
    }
    if (
      responseMode === 'explain' &&
      technical.rsi.value !== null &&
      technical.summarySignal !== 'neutral'
    ) {
      whyNowPoints.push(
        isZh
          ? `技术面目前偏 ${technical.summarySignal}，但这里更适合把它当成“辅助解释”，而不是单独下结论。`
          : `Technicals currently lean ${technical.summarySignal}, but here they are better treated as supporting explanation rather than the main conclusion.`,
      );
    }
    if (
      responseMode === 'assess' &&
      sentiment.sentimentScore !== null
    ) {
      whyNowPoints.push(
        isZh
          ? `情绪指标目前偏 ${sentiment.signal}，情绪分数约 ${sentiment.sentimentScore.toFixed(1)}。这可以作为投资判断的辅助，但不应单独替代基本面和风险评估。`
          : `Sentiment currently reads ${sentiment.signal} with a score near ${sentiment.sentimentScore.toFixed(1)}. It is useful as supporting context, but it should not replace fundamentals and risk assessment.`,
      );
    }
    if (whyNowPoints.length === 0) {
      whyNowPoints.push(
        isZh
          ? `当前围绕 ${symbol} 的可见证据还比较有限，因此更适合抓住已经确认的核心信息，而不是延伸过度。`
          : `Visible evidence around ${symbol} is still limited, so it is better to stay close to the confirmed facts than to overextend the story.`,
      );
    }

    const implicationPoints: string[] = [];
    if (responseMode === 'explain') {
      implicationPoints.push(
        isZh
          ? `这更像是在回答“为什么会这样”，而不是回答“现在该怎么交易”。如果用户关心的是近期动向、L2 进展、上涨驱动或情绪/基本面的占比，当前证据已经足够支持解释框架。`
          : `This is better treated as an explanation of what is happening than as a trading instruction. If the user cares about recent developments, ecosystem progress, drivers, or whether the move is fundamentals versus sentiment, the current evidence is enough to support an explanatory frame.`,
      );
      implicationPoints.push(
        isZh
          ? `普通读者更应该关注变化背后的持续性：是产品/生态在改善，还是只是情绪短期放大。`
          : `For general readers, the more important question is persistence: is the move backed by improving product or ecosystem traction, or is it mainly a short-term amplification of sentiment?`,
      );
    } else {
      implicationPoints.push(
        isZh
          ? `${symbol} 当前可以被讨论为一个投资命题，但更重要的是先判断理由是否扎实、风险是否可接受，而不是直接把它理解成短线买卖建议。`
          : `${symbol} can be discussed as an investment thesis right now, but the key is whether the reasons are durable and the risks acceptable, not whether it immediately translates into a short-term trade.`,
      );
      implicationPoints.push(
        isZh
          ? `如果你的问题是“现在适不适合投资”，更稳妥的理解方式是：先看基本面、供给和风险，再看价格与情绪有没有明显跑得太快。`
          : `If the real question is whether it is investable now, the more reliable order is fundamentals, supply, and risk first, then whether price and sentiment have run too far ahead.`,
      );
    }

    const watchPoints: string[] = [];
    if (news.items.length > 0) {
      watchPoints.push(
        isZh
          ? `后续先看最近这些事件有没有持续跟进，而不是只看一天内的价格反应。`
          : `Watch whether the recent events continue to develop rather than focusing only on the one-day price reaction.`,
      );
    }
    if (openResearch.enabled && openResearch.takeaways.length > 0) {
      watchPoints.push(
        isZh
          ? `开放检索提炼出的线索需要继续验证，看它们是否仍被后续公开信息支持。`
          : `The open-research takeaways should be tracked to see whether later public information continues to support them.`,
      );
    }
    if (fundamentals.profile.tags.length > 0) {
      watchPoints.push(
        isZh
          ? `接下来重点看 ${symbol} 在 ${fundamentals.profile.tags.slice(0, 2).join('、')} 这些标签对应方向上，是否真的继续有进展。`
          : `A key thing to watch next is whether ${symbol} continues to show real progress in areas such as ${fundamentals.profile.tags.slice(0, 2).join(', ')}.`,
      );
    }
    if (responseMode === 'assess' && tokenomics.inflationRate.currentAnnualPct !== null) {
      watchPoints.push(
        isZh
          ? `还要持续观察供给侧压力是否变化，尤其是通胀、销毁、回购或融资信息有没有新的边际变化。`
          : `Also watch whether supply-side pressure changes, especially through inflation, burns, buybacks, or fundraising updates.`,
      );
    }
    if (watchPoints.length === 0) {
      watchPoints.push(
        isZh
          ? '接下来重点不是追着短线波动跑，而是看支撑这次判断的证据会不会继续改善或被证伪。'
          : 'The next thing to watch is not every short-term price swing, but whether the evidence supporting this view keeps improving or gets disproved.',
      );
    }

    const qualityPoints: string[] = [];
    if (analysis.hardBlocks.length > 0) {
      qualityPoints.push(
        isZh
          ? `当前存在硬性限制：${analysis.hardBlocks.join('、')}。`
          : `Hard blocks remain active: ${analysis.hardBlocks.join(', ')}.`,
      );
    }
    if (userVisibleAlerts.redCount > 0) {
      qualityPoints.push(
        isZh
          ? `存在 ${userVisibleAlerts.redCount} 条严重风险告警。`
          : `${userVisibleAlerts.redCount} critical risk alerts are active.`,
      );
    }
    if (userVisibleAlerts.yellowCount > 0) {
      qualityPoints.push(
        isZh
          ? `存在 ${userVisibleAlerts.yellowCount} 条警告项，结论需要配合风控理解。`
          : `${userVisibleAlerts.yellowCount} warning items are active, so the view should be handled with risk controls.`,
      );
    }
    if (execution.degradedNodes.length > 0) {
      this.logger.warn(
        `Degraded data sources suppressed from report for ${execution.identity.symbol}: ${execution.degradedNodes.join(', ')}`,
      );
    }
    if (execution.missingEvidence.length > 0) {
      this.logger.warn(
        `Missing evidence suppressed from report for ${execution.identity.symbol}: ${execution.missingEvidence.join(', ')}`,
      );
    }
    if (security.riskLevel !== 'low') {
      qualityPoints.push(
        isZh
          ? `安全风险等级为 ${security.riskLevel}，这会直接限制结论能有多乐观。`
          : `Security risk is ${security.riskLevel}, which directly caps how constructive this view can be.`,
      );
    }
    if (liquidity.rugpullRiskSignal !== 'low' || liquidity.withdrawalRiskFlag) {
      qualityPoints.push(
        isZh
          ? '流动性质量存在额外顾虑，这意味着“看起来有道理”和“真的适合参与”之间可能有差距。'
          : 'Liquidity quality carries added concerns, which means "interesting thesis" and "actually investable" may not be the same thing.',
      );
    }
    if (tokenomics.tokenomicsEvidenceInsufficient) {
      qualityPoints.push(
        isZh
          ? '代币经济证据还不够完整，所以关于稀释、销毁、回购或融资影响的判断应保留一定弹性。'
          : 'Tokenomics evidence is still incomplete, so any read on dilution, burns, buybacks, or fundraising should be treated with some flexibility.',
      );
    }
    if (responseMode === 'explain') {
      qualityPoints.push(
        isZh
          ? '最大的误区是把暂时性的情绪或单条消息，误读成已经被长期证据确认的趋势。'
          : 'The biggest mistake here would be to treat temporary sentiment or a single news item as if it were already a long-term confirmed trend.',
      );
    } else {
      qualityPoints.push(
        isZh
          ? '最大的风险不是价格波动本身，而是支撑投资逻辑的证据没有持续兑现。'
          : 'The biggest risk is not price volatility by itself, but the possibility that the evidence supporting the investment thesis does not continue to validate.',
      );
    }

    const reportMeta: ReportMeta = {
      keyTakeaway: keySignals[0] ?? executiveSummary,
      whyNow: whyNowPoints,
      actionGuidance: implicationPoints,
      keyTriggers: watchPoints,
      invalidationSignals: qualityPoints,
      dataQualityNotes: [],
      scenarioMap: [],
    };
    const sections = this.buildSectionsFromReportMeta(
      reportMeta,
      isZh,
      responseMode,
    );

    const disclaimer = isZh
      ? '本报告仅供研究参考，不构成投资建议。投资有风险，入市需谨慎。'
      : 'This report is for research purposes only and does not constitute investment advice. Please invest responsibly.';
    const body = this.buildExplainAssessNarrativeBody({
      title,
      executiveSummary,
      reportMeta,
      responseMode,
      execution,
      disclaimer,
      isZh,
    });

    return {
      title,
      executiveSummary,
      body,
      sections,
      reportMeta,
      verdict: analysis.verdict,
      confidence: analysis.confidence,
      disclaimer,
    };
  }

  private buildActionReport(
    input: RenderReportInput,
    responseMode: Extract<PlanResponseMode, 'act'>,
  ): ReportOutput {
    const isZh = input.intent.language === 'zh';
    const { execution, analysis, alerts } = input;
    const advisory = analysis;
    const price = execution.data.market.price;
    const technical = execution.data.technical;
    const security = execution.data.security;
    const liquidity = execution.data.liquidity;
    const onchain = execution.data.onchain.cexNetflow;
    const tokenomics = execution.data.tokenomics;
    const fundamentals = execution.data.fundamentals;
    const sentiment = execution.data.sentiment;
    const userVisibleAlerts = this.filterUserVisibleAlerts(alerts);
    const visibleReason = this.toVisibleReason(analysis, isZh);
    const visibleEvidence = this.filterUserVisibleItems(advisory.evidence);

    const verdictLabel = this.toVisibleVerdictLabel(advisory.verdict, isZh);

    const title = isZh
      ? `${execution.identity.symbol} 分析报告 - ${verdictLabel}`
      : `${execution.identity.symbol} Analysis - ${verdictLabel}`;

    const confidence = advisory.confidence ?? 0;
    const executiveSummary = [
      visibleReason,
      isZh
        ? `${execution.identity.symbol} 当前更适合按「${verdictLabel}」理解，整体置信度 ${(confidence * 100).toFixed(0)}%。`
        : `${execution.identity.symbol} is best read as "${verdictLabel}" right now with ${(confidence * 100).toFixed(0)}% confidence.`,
    ].join('\n');

    const keySignals: string[] = [];
    keySignals.push(
      isZh
        ? `${execution.identity.symbol} 当前结论为「${verdictLabel}」，核心判断是：${visibleReason}`
        : `${execution.identity.symbol} is currently rated "${verdictLabel}" because ${visibleReason}`,
    );
    if (visibleEvidence.length > 0) {
      keySignals.push(
        isZh
          ? `最重要的支撑理由是：${visibleEvidence.slice(0, 2).join('；')}`
          : `The strongest supporting reasons are: ${visibleEvidence.slice(0, 2).join('; ')}`,
      );
    }

    const marketContextPoints: string[] = [];
    const marketLine = this.buildMarketContextLine(price, isZh);
    if (marketLine) {
      marketContextPoints.push(marketLine);
    }
    marketContextPoints.push(
      isZh
        ? `技术面整体偏 ${technical.summarySignal}，链上资金流表现为 ${onchain.signal.replace('_', ' ')}，市场情绪则偏 ${sentiment.signal}。`
        : `Technicals read ${technical.summarySignal}, on-chain flow reads ${onchain.signal.replace('_', ' ')}, and sentiment remains ${sentiment.signal}.`,
    );
    if (technical.rsi.value !== null) {
      marketContextPoints.push(
        isZh
          ? `RSI 约为 ${technical.rsi.value.toFixed(1)}，这意味着短线并不处在特别舒服的追价位置。`
          : `RSI is near ${technical.rsi.value.toFixed(1)}, which means the short-term setup is not especially comfortable for chasing.`,
      );
    }
    if (fundamentals.profile.name || fundamentals.profile.oneLiner) {
      marketContextPoints.push(
        isZh
          ? `基本面上，${fundamentals.profile.name ?? execution.identity.symbol}${fundamentals.profile.oneLiner ? ` 仍然可以概括为「${fundamentals.profile.oneLiner}」` : ''}。`
          : `From a fundamentals angle, ${fundamentals.profile.name ?? execution.identity.symbol}${fundamentals.profile.oneLiner ? ` can still be summarized as "${fundamentals.profile.oneLiner}"` : ''}.`,
      );
    }
    if (tokenomics.inflationRate.currentAnnualPct !== null) {
      marketContextPoints.push(
        isZh
          ? `代币经济层面没有出现明显失控的稀释压力。`
          : `Tokenomics do not currently point to an obviously destabilizing dilution profile.`,
      );
    }

    const strategyPoints: string[] = [];
    if (advisory.buyZone) {
      strategyPoints.push(
        isZh
          ? `如果继续等待更积极的执行点，可以把关注重点放在：${advisory.buyZone}。`
          : `If you still want a constructive setup, focus on: ${advisory.buyZone}.`,
      );
    }
    if (advisory.sellZone) {
      strategyPoints.push(
        isZh
          ? `当前更适合执行的动作是：${advisory.sellZone}。`
          : `The more appropriate action right now is: ${advisory.sellZone}.`,
      );
    }

    const ts = advisory.tradingStrategy;
    if (ts) {
      if (ts.note) {
        strategyPoints.push(ts.note);
      }
      if (ts.supportLevels.length > 0) {
        strategyPoints.push(
          isZh
            ? `如果要继续观察回踩，先盯住最关键的支撑：${ts.supportLevels[0]?.label}。`
            : `If pullback monitoring continues, start with the main support at ${ts.supportLevels[0]?.label}.`,
        );
      }
      if (ts.resistanceLevels.length > 0) {
        strategyPoints.push(
          isZh
            ? `上方最重要的压力先看 ${ts.resistanceLevels[0]?.label}，不要把压力位误判成趋势确认。`
            : `The most important overhead pressure is ${ts.resistanceLevels[0]?.label}; avoid reading that area as confirmed trend too early.`,
        );
      }
    }
    if (strategyPoints.length === 0) {
      strategyPoints.push(
        isZh
          ? '当前更适合继续观察，等待下一步确认，而不是立即做激进行动。'
          : 'Observation is more appropriate than forcing immediate action.',
      );
    }

    const triggerPoints: string[] = [];
    if (advisory.buyZone) {
      triggerPoints.push(
        isZh
          ? `若后续重新转强，先看是否重新回到并站稳 ${advisory.buyZone}。`
          : `If the setup turns constructive again, first watch whether price can reclaim and hold ${advisory.buyZone}.`,
      );
    }
    if (advisory.sellZone) {
      triggerPoints.push(
        isZh
          ? `若出现反弹，进入 ${advisory.sellZone} 仍更适合按防守思路处理。`
          : `If a bounce appears, ${advisory.sellZone} remains the area to treat defensively.`,
      );
    }
    if (ts?.supportLevels.length) {
      triggerPoints.push(
        isZh
          ? `下方先看 ${ts.supportLevels[0]?.label}，这里守不住时，短线判断需要下修。`
          : `Start with ${ts.supportLevels[0]?.label} on the downside; if that fails, the short-term read should be marked down.`,
      );
    }
    if (ts?.resistanceLevels.length) {
      triggerPoints.push(
        isZh
          ? `上方先看 ${ts.resistanceLevels[0]?.label}，只有明显站上后，才适合重新讨论更积极的判断。`
          : `Start with ${ts.resistanceLevels[0]?.label} on the upside; only a clear break above it justifies a more constructive reassessment.`,
      );
    }
    if (ts?.stopLoss) {
      triggerPoints.push(
        isZh
          ? `若价格触发 ${ts.stopLoss.label}，这次判断应立即重审。`
          : `If ${ts.stopLoss.label} is triggered, this view should be re-evaluated immediately.`,
      );
    }
    const qualityPoints: string[] = [];
    if (advisory.hardBlocks.length > 0) {
      qualityPoints.push(
        isZh
          ? `当前存在硬性限制：${advisory.hardBlocks.join('、')}。`
          : `Hard blocks remain active: ${advisory.hardBlocks.join(', ')}.`,
      );
    }
    if (userVisibleAlerts.redCount > 0) {
      qualityPoints.push(
        isZh
          ? `存在 ${userVisibleAlerts.redCount} 条严重风险告警。`
          : `${userVisibleAlerts.redCount} critical risk alerts are active.`,
      );
    }
    if (userVisibleAlerts.yellowCount > 0) {
      qualityPoints.push(
        isZh
          ? `存在 ${userVisibleAlerts.yellowCount} 条警告项，结论需要配合风控理解。`
          : `${userVisibleAlerts.yellowCount} warning items are active, so the view should be handled with risk controls.`,
      );
    }
    if (execution.degradedNodes.length > 0) {
      this.logger.warn(
        `Degraded data sources suppressed from report for ${execution.identity.symbol}: ${execution.degradedNodes.join(', ')}`,
      );
    }
    if (execution.missingEvidence.length > 0) {
      this.logger.warn(
        `Missing evidence suppressed from report for ${execution.identity.symbol}: ${execution.missingEvidence.join(', ')}`,
      );
    }
    if (security.riskLevel !== 'low') {
      qualityPoints.push(
        isZh
          ? `安全风险等级为 ${security.riskLevel}，因此不适合把这次结论理解得过于乐观。`
          : `Security risk is ${security.riskLevel}, so this read should not be treated too optimistically.`,
      );
    }
    if (liquidity.rugpullRiskSignal !== 'low' || liquidity.withdrawalRiskFlag) {
      qualityPoints.push(
        isZh
          ? '流动性质量存在额外顾虑，执行时需要优先考虑滑点与退出难度。'
          : 'Liquidity quality carries added concerns, so slippage and exit conditions need priority attention.',
      );
    }
    qualityPoints.push(
      isZh
        ? '若后续风险告警继续增加或关键支撑失守，这次判断就不该继续沿用。'
        : 'If alerts continue rising or key support breaks, this view should not be carried forward unchanged.',
    );
    if (qualityPoints.length === 0) {
      qualityPoints.push(
        isZh
          ? '核心证据基本完整，这次结论可直接作为当前判断参考。'
          : 'Core evidence is largely intact, so this read can be used as a practical reference.',
      );
    }

    const reportMeta: ReportMeta = {
      keyTakeaway: keySignals[0] ?? executiveSummary,
      whyNow: marketContextPoints,
      actionGuidance: strategyPoints,
      keyTriggers: triggerPoints,
      invalidationSignals: qualityPoints.slice(-1),
      dataQualityNotes: [],
      scenarioMap: [],
    };
    const sections = this.buildSectionsFromReportMeta(
      reportMeta,
      isZh,
      responseMode,
    );

    const body = this.buildNarrativeBody({
      title,
      executiveSummary,
      reportMeta,
      responseMode,
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。投资有风险，入市需谨慎。'
        : 'This report is for research purposes only and does not constitute investment advice. Please invest responsibly.',
    });

    return {
      title,
      executiveSummary,
      body,
      sections,
      reportMeta,
      verdict: advisory.verdict,
      confidence: advisory.confidence,
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。投资有风险，入市需谨慎。'
        : 'This report is for research purposes only and does not constitute investment advice. Please invest responsibly.',
    };
  }

  private finalizeReport(
    report: ReportOutput,
    input: RenderReportInput,
  ): ReportOutput {
    const responseMode =
      input.plan?.responseMode ?? this.inferResponseMode(input.intent);
    const normalizedSections = report.sections.filter(
      (section) =>
        section.heading.trim().length > 0 && section.points.length > 0,
    );
    const reportMeta =
      report.reportMeta ??
      this.toReportMetaFromSections(
        normalizedSections,
        input.intent.language === 'zh',
        responseMode,
        report.executiveSummary,
      );
    const fallbackBody = this.buildNarrativeBody({
      title: report.title,
      executiveSummary: report.executiveSummary,
      reportMeta,
      responseMode,
      disclaimer: report.disclaimer,
    });

    return {
      ...report,
      sections: normalizedSections,
      reportMeta,
      body:
        report.body.trim().length > 0 &&
        report.body.trim() !== report.executiveSummary.trim()
          ? report.body.trim()
          : fallbackBody,
      verdict: input.analysis.verdict,
      confidence: input.analysis.confidence,
    };
  }

  private composeReport(
    narrative: ReportNarrative,
    fallback: ReportOutput,
    input: RenderReportInput,
  ): ReportOutput {
    const title = this.sanitizeUserFacingText(
      narrative.title.trim(),
      fallback.title,
    );
    return {
      title,
      executiveSummary: this.sanitizeUserFacingText(
        narrative.executiveSummary.trim(),
        fallback.executiveSummary,
      ),
      body: this.normalizeUserFacingBody(
        this.sanitizeUserFacingBody(narrative.body.trim(), fallback.body),
        title,
      ),
      sections: fallback.sections,
      reportMeta: fallback.reportMeta,
      verdict: input.analysis.verdict,
      confidence: input.analysis.confidence,
      disclaimer: this.sanitizeUserFacingText(
        narrative.disclaimer.trim(),
        fallback.disclaimer,
      ),
    };
  }

  private toNarrativeFallback(report: ReportOutput): ReportNarrative {
    return {
      title: report.title,
      executiveSummary: report.executiveSummary,
      body: report.body,
      disclaimer: report.disclaimer,
    };
  }

  private buildNarrativeBody(input: {
    title: string;
    executiveSummary: string;
    reportMeta: ReportMeta;
    responseMode: PlanResponseMode;
    disclaimer: string;
  }): string {
    const sections = this.buildSectionsFromReportMeta(
      input.reportMeta,
      /[\u4e00-\u9fff]/.test(input.executiveSummary + input.title),
      input.responseMode,
    );
    const sectionBlocks = sections.map((section) => {
      const narrative = section.points.map((point) => `- ${point}`).join('\n');
      return `## ${section.heading}\n${narrative}`;
    });

    return [
      `# ${input.title}`,
      '',
      input.executiveSummary,
      '',
      ...sectionBlocks.flatMap((block) => ['', block]),
      '',
      input.disclaimer,
    ]
      .join('\n')
      .trim();
  }

  private buildExplainAssessNarrativeBody(input: {
    title: string;
    executiveSummary: string;
    reportMeta: ReportMeta;
    responseMode: Extract<PlanResponseMode, 'explain' | 'assess'>;
    execution: ExecutionOutput;
    disclaimer: string;
    isZh: boolean;
  }): string {
    const headings = this.getSectionHeadings(
      input.responseMode,
      input.isZh,
    );
    const snapshotTable = this.buildMiniSnapshotTable(
      input.execution,
      input.responseMode,
      input.isZh,
    );
    const liquidityStructureTable = this.buildLiquidityStructureTable(
      input.execution,
      input.isZh,
    );
    const fundamentalsDetailTable = this.buildFundamentalsDetailTable(
      input.execution,
      input.isZh,
    );
    const externalEvidence = this.buildExternalEvidenceSubsection(
      input.execution,
      input.isZh,
    );
    const blocks: string[] = [
      `# ${input.title}`,
      '',
      `## ${headings.core}`,
      input.executiveSummary,
    ];

    if (snapshotTable) {
      blocks.push(
        '',
        input.isZh ? '### 一眼先看' : '### Snapshot',
        snapshotTable,
      );
    }
    if (liquidityStructureTable) {
      blocks.push(
        '',
        input.isZh ? '### 流动性结构' : '### Liquidity Structure',
        liquidityStructureTable,
      );
    }
    if (fundamentalsDetailTable) {
      blocks.push(
        '',
        input.isZh ? '### 基本面抓手' : '### Fundamentals Detail',
        fundamentalsDetailTable,
      );
    }

    if (input.reportMeta.whyNow.length > 0) {
      blocks.push(
        '',
        `## ${headings.why}`,
        this.renderNarrativeParagraphs(input.reportMeta.whyNow),
      );
      if (externalEvidence) {
        blocks.push(
          '',
          input.isZh ? '### 外部检索补充' : '### Open-Web Evidence',
          externalEvidence,
        );
      }
    }

    if (input.reportMeta.actionGuidance.length > 0) {
      blocks.push(
        '',
        `## ${headings.action}`,
        this.renderNarrativeParagraphs(input.reportMeta.actionGuidance),
      );
    }

    if (input.reportMeta.keyTriggers.length > 0) {
      blocks.push(
        '',
        `## ${headings.triggers}`,
        this.renderNarrativeParagraphs(input.reportMeta.keyTriggers),
      );
    }

    const qualityPoints = [
      ...input.reportMeta.dataQualityNotes,
      ...input.reportMeta.invalidationSignals,
    ];
    if (qualityPoints.length > 0) {
      blocks.push(
        '',
        `## ${headings.risks}`,
        this.renderNarrativeParagraphs(qualityPoints),
      );
    }

    blocks.push('', input.disclaimer);
    return blocks.join('\n').trim();
  }

  private fmt(value: number | null): string {
    if (value === null) return 'N/A';
    if (Math.abs(value) >= 1_000_000_000)
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000)
      return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return value.toFixed(2);
  }

  private fmtValue(value: number | null): string {
    return this.fmt(value);
  }

  private buildMarketContextLine(
    price: ExecutionOutput['data']['market']['price'],
    isZh: boolean,
  ): string | null {
    if (price.priceUsd === null && price.change24hPct === null) {
      return null;
    }

    const priceText =
      price.priceUsd === null
        ? null
        : `$${price.priceUsd < 1 ? price.priceUsd.toFixed(6) : price.priceUsd.toFixed(2)}`;
    const changeText =
      price.change24hPct === null
        ? null
        : `${price.change24hPct >= 0 ? '+' : ''}${price.change24hPct.toFixed(2)}%`;

    if (isZh) {
      if (priceText && changeText) {
        return `当前价格约 ${priceText}，24h 变化 ${changeText}，这提供了这次判断的基本位置感。`;
      }
      if (priceText) {
        return `当前价格约 ${priceText}，可作为这次判断的基础参考。`;
      }
      return `24h 价格变化约为 ${changeText}，说明短线波动仍然值得重视。`;
    }

    if (priceText && changeText) {
      return `Price is around ${priceText} with a 24h move of ${changeText}, which frames the basic market position behind this view.`;
    }
    if (priceText) {
      return `Price is around ${priceText}, which serves as the base reference for this read.`;
    }
    return `The 24h move is about ${changeText}, which still matters for short-term positioning.`;
  }

  private buildSectionsFromReportMeta(
    reportMeta: ReportMeta,
    isZh: boolean,
    responseMode: PlanResponseMode,
  ): Array<{ heading: string; points: string[] }> {
    const headings = this.getSectionHeadings(responseMode, isZh);
    const sections: Array<{ heading: string; points: string[] }> = [];
    sections.push({
      heading: headings.core,
      points: [reportMeta.keyTakeaway],
    });
    if (reportMeta.whyNow.length > 0) {
      sections.push({
        heading: headings.why,
        points: reportMeta.whyNow,
      });
    }
    if (reportMeta.actionGuidance.length > 0) {
      sections.push({
        heading: headings.action,
        points: reportMeta.actionGuidance,
      });
    }
    if (reportMeta.keyTriggers.length > 0) {
      sections.push({
        heading: headings.triggers,
        points: reportMeta.keyTriggers,
      });
    }
    const qualityPoints = [
      ...reportMeta.dataQualityNotes,
      ...reportMeta.invalidationSignals,
    ];
    if (qualityPoints.length > 0) {
      sections.push({
        heading: headings.risks,
        points: qualityPoints,
      });
    }
    return sections;
  }

  private toReportMetaFromSections(
    sections: Array<{ heading: string; points: string[] }>,
    isZh: boolean,
    responseMode: PlanResponseMode,
    executiveSummary: string,
  ): ReportMeta {
    const headings = this.getSectionHeadings(responseMode, isZh);
    const byHeading = new Map(
      sections.map((section) => [section.heading, section.points]),
    );
    const core = byHeading.get(headings.core) ?? [executiveSummary];
    const why = byHeading.get(headings.why) ?? [];
    const action = byHeading.get(headings.action) ?? [];
    const triggers = byHeading.get(headings.triggers) ?? [];
    return {
      keyTakeaway: core[0] ?? executiveSummary,
      whyNow: why,
      actionGuidance: action,
      keyTriggers: triggers,
      invalidationSignals: [],
      dataQualityNotes: [],
      scenarioMap: [],
    };
  }

  private buildRecentEvidenceLine(
    execution: ExecutionOutput,
    responseMode: Extract<PlanResponseMode, 'explain' | 'assess'>,
    isZh: boolean,
  ): string | null {
    const openResearch = execution.data.openResearch ?? {
      enabled: false,
      takeaways: [],
      items: [],
    };
    const news = execution.data.news;

    if (openResearch.enabled && openResearch.takeaways.length > 0) {
      const takeaway = openResearch.takeaways.slice(0, 2).join('；');
      return responseMode === 'explain'
        ? isZh
          ? `结合开放检索，当前最值得关注的新线索是：${takeaway}`
          : `From open research, the most important recent clue is: ${takeaway}`
        : isZh
          ? `结合开放检索，当前投资判断最需要关注的新线索是：${takeaway}`
          : `From open research, the newest clue that matters most for the investment view is: ${takeaway}`;
    }

    if (news.items.length > 0) {
      const latest = news.items
        .slice(0, 2)
        .map((item) => `${item.source}《${item.title}》`)
        .join('、');
      return responseMode === 'explain'
        ? isZh
          ? `最近公开信息里，最相关的线索包括 ${latest}，说明市场正在围绕这类变化重新定价。`
          : `Among recent public items, the most relevant clues include ${latest}, which suggests the market is repricing around that change.`
        : isZh
          ? `最近公开信息里，最相关的线索包括 ${latest}，这会直接影响当前投资判断应如何定调。`
          : `Among recent public items, the most relevant clues include ${latest}, which directly affects how the current investment view should be framed.`;
    }

    return null;
  }

  private buildMiniSnapshotTable(
    execution: ExecutionOutput,
    responseMode: Extract<PlanResponseMode, 'explain' | 'assess'>,
    isZh: boolean,
  ): string | null {
    const price = execution.data.market.price;
    const sentiment = execution.data.sentiment;
    const onchain = execution.data.onchain.cexNetflow;
    const tokenomics = execution.data.tokenomics;
    const security = execution.data.security;
    const liquidity = execution.data.liquidity;
    const openResearch = execution.data.openResearch;
    const primaryVenue = liquidity.primaryVenue ?? liquidity.topVenues?.[0] ?? null;

    const rows: Array<[string, string, string]> =
      responseMode === 'explain'
        ? [
            [
              isZh ? '价格' : 'Price',
              price.priceUsd === null
                ? '-'
                : `$${price.priceUsd < 1 ? price.priceUsd.toFixed(6) : price.priceUsd.toFixed(2)}`,
              `${this.safePct(price.change24hPct)} / ${this.safePct(price.change7dPct)}`,
            ],
            [
              isZh ? '情绪' : 'Sentiment',
              sentiment.signal,
              sentiment.sentimentScore === null
                ? isZh
                  ? '当前不是极端情绪'
                  : 'No extreme sentiment reading'
                : isZh
                  ? `分数 ${sentiment.sentimentScore.toFixed(1)}`
                  : `Score ${sentiment.sentimentScore.toFixed(1)}`,
            ],
            [
              isZh ? '主市场' : 'Primary Venue',
              primaryVenue?.pairLabel ??
                (liquidity.quoteToken === 'OTHER'
                  ? '-'
                  : `${execution.identity.symbol}/${liquidity.quoteToken}`),
              primaryVenue
                ? [
                    primaryVenue.venueName,
                    primaryVenue.liquidityUsd !== null
                      ? this.fmt(primaryVenue.liquidityUsd)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')
                : isZh
                  ? '看主流动性落点'
                  : 'Checks where liquidity concentrates',
            ],
            [
              isZh ? '链上资金' : 'On-chain',
              onchain.signal,
              isZh ? '看资金是否真的跟进' : 'Checks whether flows confirm the move',
            ],
          ]
        : [
            [
              isZh ? '价格' : 'Price',
              price.priceUsd === null
                ? '-'
                : `$${price.priceUsd < 1 ? price.priceUsd.toFixed(6) : price.priceUsd.toFixed(2)}`,
              `${this.safePct(price.change24hPct)} / ${this.safePct(price.change7dPct)}`,
            ],
            [
              isZh ? '供给压力' : 'Supply',
              tokenomics.inflationRate.currentAnnualPct === null
                ? isZh
                  ? '未明确'
                  : 'Unclear'
                : `${tokenomics.inflationRate.currentAnnualPct.toFixed(2)}%`,
              isZh ? '看稀释是否可控' : 'Tests dilution pressure',
            ],
            [
              isZh ? '安全/流动性' : 'Risk',
              `${security.riskLevel} / ${liquidity.rugpullRiskSignal}`,
              isZh ? '决定是否真的可参与' : 'Determines practical investability',
            ],
            [
              isZh ? '主市场' : 'Primary Venue',
              primaryVenue?.pairLabel ??
                (liquidity.quoteToken === 'OTHER'
                  ? '-'
                  : `${execution.identity.symbol}/${liquidity.quoteToken}`),
              primaryVenue
                ? [
                    primaryVenue.venueName,
                    primaryVenue.marketSharePct !== null
                      ? `${primaryVenue.marketSharePct.toFixed(1)}% share`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')
                : isZh
                  ? '看流动性集中度'
                  : 'Shows where liquidity concentrates',
            ],
            [
              isZh ? '市场情绪' : 'Sentiment',
              sentiment.signal,
              sentiment.sentimentScore === null
                ? isZh
                  ? '热度不能单独决定价值'
                  : 'Hype alone does not decide value'
                : isZh
                  ? `分数 ${sentiment.sentimentScore.toFixed(1)}`
                  : `Score ${sentiment.sentimentScore.toFixed(1)}`,
            ],
          ];

    if (
      responseMode === 'explain' &&
      openResearch?.enabled &&
      openResearch.takeaways.length > 0
    ) {
      rows.push([
        isZh ? '外部证据' : 'Open Web',
        isZh ? '已纳入' : 'Included',
        openResearch.takeaways[0],
      ]);
    }

    return [
      `| ${isZh ? '维度' : 'Dimension'} | ${isZh ? '当前值' : 'Current'} | ${isZh ? '怎么理解' : 'What It Means'} |`,
      '|---|---|---|',
      ...rows.map(
        ([label, value, note]) => `| ${label} | ${value} | ${note} |`,
      ),
    ].join('\n');
  }

  private buildExternalEvidenceSubsection(
    execution: ExecutionOutput,
    isZh: boolean,
  ): string {
    const parts: string[] = [];
    const openResearch = execution.data.openResearch;
    const news = execution.data.news;

    if (openResearch?.enabled && openResearch.items.length > 0) {
      for (const item of openResearch.items.slice(0, 4)) {
        parts.push(
          isZh
            ? `- ${item.source}：${item.title}`
            : `- ${item.source}: ${item.title}`,
        );
      }
    } else if (news.items.length > 0) {
      for (const item of news.items.slice(0, 4)) {
        parts.push(
          isZh
            ? `- ${item.source}：${item.title}`
            : `- ${item.source}: ${item.title}`,
        );
      }
    }

    return parts.join('\n');
  }

  private renderNarrativeParagraphs(points: string[]): string {
    return points.map((point) => point.trim()).filter(Boolean).join('\n\n');
  }

  private buildLiquidityStructureTable(
    execution: ExecutionOutput,
    isZh: boolean,
  ): string | null {
    const venues = (execution.data.liquidity.topVenues ?? []).slice(0, 4);
    if (venues.length === 0) {
      return null;
    }

    return [
      `| ${isZh ? '市场/池子' : 'Venue'} | ${isZh ? '交易对' : 'Pair'} | ${isZh ? '深度与成交' : 'Depth And Volume'} |`,
      '|---|---|---|',
      ...venues.map((venue) => {
        const facts = [
          venue.liquidityUsd !== null ? `$${this.fmtValue(venue.liquidityUsd)}` : null,
          venue.volume24hUsd !== null
            ? `${isZh ? '24h量' : '24h vol'} ${this.fmtValue(venue.volume24hUsd)}`
            : null,
          venue.marketSharePct !== null
            ? `${venue.marketSharePct.toFixed(1)}% ${isZh ? '占比' : 'share'}`
            : null,
        ]
          .filter(Boolean)
          .join(' / ');
        return `| ${venue.venueName ?? (venue.venueType === 'dex_pool' ? 'DEX Pool' : 'CEX Market')} | ${venue.pairLabel} | ${facts} |`;
      }),
    ].join('\n');
  }

  private buildFundamentalsDetailTable(
    execution: ExecutionOutput,
    isZh: boolean,
  ): string | null {
    const fundamentals = execution.data.fundamentals;
    const rows: Array<[string, string, string]> = [];

    if (fundamentals.profile.totalFundingUsd !== null) {
      rows.push([
        isZh ? '累计融资' : 'Funding',
        `$${this.fmtValue(fundamentals.profile.totalFundingUsd)}`,
        isZh ? '资本背书强度' : 'Capital support',
      ]);
    }
    if (fundamentals.investors.length > 0) {
      rows.push([
        isZh ? '投资方' : 'Investors',
        fundamentals.investors
          .map((item) => item.name)
          .slice(0, 3)
          .join(', '),
        isZh
          ? `共 ${fundamentals.investors.length} 家`
          : `${fundamentals.investors.length} investors`,
      ]);
    }
    if (fundamentals.fundraising.length > 0) {
      const latestRound = fundamentals.fundraising[0];
      rows.push([
        isZh ? '最近融资' : 'Latest Round',
        [latestRound.round, latestRound.amountUsd !== null ? `$${this.fmtValue(latestRound.amountUsd)}` : null]
          .filter(Boolean)
          .join(' / '),
        latestRound.investors.slice(0, 2).join(', ') ||
          (isZh ? '未披露投资方' : 'No named investors'),
      ]);
    }
    const ecosystems = [
      ...fundamentals.ecosystems.ecosystems,
      ...fundamentals.ecosystems.onMainNet,
      ...fundamentals.ecosystems.onTestNet,
      ...fundamentals.ecosystems.planToLaunch,
    ];
    if (ecosystems.length > 0) {
      rows.push([
        isZh ? '生态触点' : 'Ecosystem',
        ecosystems.slice(0, 3).join(', '),
        isZh ? `共 ${ecosystems.length} 个方向` : `${ecosystems.length} ecosystem hooks`,
      ]);
    }
    if (fundamentals.social.followers !== null) {
      rows.push([
        isZh ? '社交关注' : 'Followers',
        fundamentals.social.followers.toLocaleString(),
        fundamentals.social.hotIndexScore !== null
          ? `Hot ${fundamentals.social.hotIndexScore.toFixed(1)}`
          : isZh
            ? '市场关注度'
            : 'Audience context',
      ]);
    }

    if (rows.length === 0) {
      return null;
    }

    return [
      `| ${isZh ? '维度' : 'Dimension'} | ${isZh ? '信息' : 'Detail'} | ${isZh ? '含义' : 'Meaning'} |`,
      '|---|---|---|',
      ...rows.map(([label, value, meaning]) => `| ${label} | ${value} | ${meaning} |`),
    ].join('\n');
  }

  private safePct(value: number | null): string {
    if (value === null) {
      return '-';
    }

    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  private getSectionHeadings(
    responseMode: PlanResponseMode,
    isZh: boolean,
  ): {
    core: string;
    why: string;
    action: string;
    triggers: string;
    risks: string;
  } {
    if (responseMode === 'explain') {
      return isZh
        ? {
            core: '核心结论',
            why: '最近发生了什么',
            action: '这意味着什么',
            triggers: '接下来观察什么',
            risks: '风险与不确定性',
          }
        : {
            core: 'Core Answer',
            why: 'What Changed Recently',
            action: 'What It Means',
            triggers: 'What To Watch Next',
            risks: 'Risks And Uncertainties',
          };
    }

    if (responseMode === 'assess') {
      return isZh
        ? {
            core: '核心结论',
            why: '支撑判断的原因',
            action: '现在如何理解投资价值',
            triggers: '接下来重点观察',
            risks: '主要风险',
          }
        : {
            core: 'Core Answer',
            why: 'Reasons Behind This View',
            action: 'How To Read The Investment Case Now',
            triggers: 'What To Watch Next',
            risks: 'Main Risks',
          };
    }

    return isZh
      ? {
          core: '核心结论',
          why: '为什么得出这个判断',
          action: '现在该怎么做',
          triggers: '关键触发位',
          risks: '风险与应对',
        }
      : {
          core: 'Core Takeaway',
          why: 'Why This View',
          action: 'What To Do Now',
          triggers: 'Key Triggers',
          risks: 'Risks And Response',
        };
  }

  private auditStructuredDataCoverage(
    report: ReportOutput,
    input: RenderReportInput,
  ): void {
    const text = [
      report.title,
      report.executiveSummary,
      report.body,
      report.sections.flatMap((section) => section.points).join('\n'),
    ]
      .join('\n')
      .toLowerCase();
    const symbol = input.execution.identity.symbol;
    const liquidityVenues = (input.execution.data.liquidity.topVenues ?? []).slice(
      0,
      3,
    );
    if (
      liquidityVenues.length > 0 &&
      !liquidityVenues.some((venue) =>
        this.containsAnyText(text, [
          venue.pairLabel,
          venue.venueName,
          venue.quoteToken,
          venue.sourceId,
        ]),
      )
    ) {
      this.logger.warn(
        `Rich liquidity evidence available but not surfaced in report for ${symbol}: ${liquidityVenues
          .map((venue) => venue.pairLabel)
          .join(', ')}`,
      );
    }

    const fundamentals = input.execution.data.fundamentals;
    const fundamentalMarkers = [
      fundamentals.profile.oneLiner,
      ...fundamentals.profile.tags.slice(0, 3),
      ...fundamentals.investors.map((item) => item.name).slice(0, 3),
      ...fundamentals.fundraising
        .flatMap((round) => [round.round, ...round.investors])
        .slice(0, 4),
      ...[
        ...fundamentals.ecosystems.ecosystems,
        ...fundamentals.ecosystems.onMainNet,
        ...fundamentals.ecosystems.onTestNet,
        ...fundamentals.ecosystems.planToLaunch,
      ].slice(0, 4),
    ];
    if (
      fundamentalMarkers.length >= 2 &&
      !this.containsAnyText(text, fundamentalMarkers)
    ) {
      this.logger.warn(
        `Rich fundamentals evidence available but not surfaced in report for ${symbol}.`,
      );
    }

    const tokenomics = input.execution.data.tokenomics;
    const hasRichTokenomics =
      tokenomics.burns.recentBurns.length > 0 ||
      tokenomics.buybacks.recentBuybacks.length > 0 ||
      tokenomics.fundraising.rounds.length > 0;
    if (
      hasRichTokenomics &&
      !this.containsAnyText(text, [
        'burn',
        '销毁',
        'buyback',
        '回购',
        'fundraising',
        '融资',
      ])
    ) {
      this.logger.warn(
        `Rich tokenomics events available but not surfaced in report for ${symbol}.`,
      );
    }
  }

  private containsAnyText(text: string, candidates: Array<string | null | undefined>): boolean {
    return candidates.some((candidate) => {
      const normalized = candidate?.trim().toLowerCase();
      return Boolean(normalized && text.includes(normalized));
    });
  }

  private inferResponseMode(intent: IntentOutput): PlanResponseMode {
    const query = intent.userQuery.toLowerCase();
    const actKeywords = [
      'buy',
      'sell',
      'entry',
      'exit',
      'support',
      'resistance',
      'take profit',
      'stop loss',
      'timing',
      '怎么买',
      '怎么卖',
      '怎么做',
      '进场',
      '出场',
      '支撑',
      '阻力',
      '止盈',
      '止损',
      '仓位',
      '操作',
      '时机',
    ];
    if (
      intent.objective === 'timing_decision' ||
      actKeywords.some((keyword) => query.includes(keyword))
    ) {
      return 'act';
    }

    const assessKeywords = [
      'invest',
      'investment',
      'worth',
      'risk',
      'valuation',
      '适合投资',
      '值得投资',
      '投资价值',
      '核心驱动',
      '最大风险',
      '值不值得',
    ];
    if (
      intent.objective === 'risk_check' ||
      assessKeywords.some((keyword) => query.includes(keyword))
    ) {
      return 'assess';
    }

    return 'explain';
  }

  private filterUserVisibleAlerts(alerts: AlertsSnapshot): {
    redCount: number;
    yellowCount: number;
    items: AlertsSnapshot['items'];
  } {
    const items = alerts.items.filter(
      (item) =>
        item.code !== 'DATA_DEGRADED' && !this.isHiddenReportText(item.message),
    );

    return {
      redCount: items.filter((item) => item.severity === 'critical').length,
      yellowCount: items.filter((item) => item.severity === 'warning').length,
      items,
    };
  }

  private filterUserVisibleItems(items: string[]): string[] {
    return items.filter((item) => !this.isHiddenReportText(item));
  }

  private toVisibleReason(analysis: AnalysisOutput, isZh: boolean): string {
    if (!this.isHiddenReportText(analysis.reason)) {
      return analysis.reason;
    }

    return {
      BUY: isZh
        ? '当前结构仍偏强，但执行上应保持节奏与纪律。'
        : 'The current structure still leans constructive, but execution should remain disciplined.',
      SELL: isZh
        ? '当前结构偏弱，更适合按防守思路处理。'
        : 'The current structure is weak enough to justify a defensive posture.',
      HOLD: isZh
        ? '当前方向性一般，更适合等待更清晰信号。'
        : 'Directional quality is still middling, so waiting for clearer signals is more appropriate.',
      CAUTION: isZh
        ? '当前更适合谨慎观察，等待更清晰的市场确认。'
        : 'A cautious read remains more appropriate until the market setup becomes clearer.',
      INSUFFICIENT_DATA: isZh
        ? '当前更适合保持观望，等待更清晰的市场确认。'
        : 'Staying on watch is more appropriate until the market setup becomes clearer.',
    }[analysis.verdict];
  }

  private toVisibleSummary(
    analysis: AnalysisOutput,
    execution: ExecutionOutput,
    isZh: boolean,
  ): string {
    if (!this.isHiddenReportText(analysis.summary)) {
      return analysis.summary;
    }

    const price = execution.data.market.price.priceUsd;
    const priceText =
      price === null
        ? isZh
          ? '当前价格附近'
          : 'around current price'
        : `$${price < 1 ? price.toFixed(6) : price.toFixed(2)}`;

    return isZh
      ? `${execution.identity.symbol} 当前围绕 ${priceText} 附近震荡，整体更适合继续观察，等待更明确的方向确认。`
      : `${execution.identity.symbol} is trading around ${priceText}, and the setup is better treated as a watchlist situation until direction becomes clearer.`;
  }

  private toVisibleVerdictLabel(
    verdict: AnalysisOutput['verdict'],
    isZh: boolean,
  ): string {
    return {
      BUY: isZh ? '买入' : 'BUY',
      SELL: isZh ? '卖出' : 'SELL',
      HOLD: isZh ? '观望' : 'HOLD',
      CAUTION: isZh ? '谨慎' : 'CAUTION',
      INSUFFICIENT_DATA: isZh ? '观望' : 'WATCH',
    }[verdict];
  }

  private sanitizeUserFacingText(value: string, fallback: string): string {
    if (!value.trim()) {
      return fallback;
    }

    if (!this.isHiddenReportText(value)) {
      return value.trim();
    }

    return fallback.trim();
  }

  private sanitizeUserFacingBody(value: string, fallback: string): string {
    if (!value.trim()) {
      return fallback;
    }

    const filtered = value
      .split('\n')
      .filter((line) => !this.isHiddenReportText(line))
      .join('\n')
      .trim();

    if (!filtered || this.isHiddenReportText(filtered)) {
      return fallback;
    }

    return filtered;
  }

  private normalizeUserFacingBody(value: string, title: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }

    if (/^#\s+/m.test(trimmed)) {
      return trimmed;
    }

    return `# ${title}\n\n${trimmed}`.trim();
  }

  private isHiddenReportText(value: string): boolean {
    return this.hiddenReportPatterns.some((pattern) => pattern.test(value));
  }

  private detectPriceAnomaly(
    price: ExecutionOutput['data']['market']['price'],
    isZh: boolean,
  ): string | null {
    const change24h = price.change24hPct;
    const change7d = price.change7dPct;

    if (change24h === null && change7d === null) return null;

    const anomalies: string[] = [];

    if (change24h !== null && Math.abs(change24h) > 5) {
      anomalies.push(
        isZh
          ? `24h 波动幅度达 ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%，属异常波动`
          : `24h move of ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% is unusually large`,
      );
    }

    if (change7d !== null && Math.abs(change7d) > 10) {
      anomalies.push(
        isZh
          ? `7d 累积变动 ${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%，趋势仍在发展中`
          : `7d cumulative move of ${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}% shows trend in progress`,
      );
    }

    if (change24h !== null && change7d !== null) {
      if (change24h > 0 && change7d < 0) {
        anomalies.push(
          isZh
            ? '短线反弹但周线仍承压，两者方向分歧需关注'
            : 'Short-term bounce while weekly trend remains under pressure — directional divergence worth watching',
        );
      }
      if (change24h < 0 && change7d > 0) {
        anomalies.push(
          isZh
            ? '短线回调但中线仍偏强，回调性质待确认'
            : 'Short-term pullback but medium-term still constructive — pullback nature needs confirmation',
        );
      }
    }

    return anomalies.length > 0 ? anomalies.join('；') : null;
  }

  private detectSocialAnomaly(
    sentiment: ExecutionOutput['data']['sentiment'],
    isZh: boolean,
  ): string | null {
    const socialVolume = sentiment.socialVolume;
    const sentimentScore = sentiment.sentimentScore;

    if (socialVolume === null && sentimentScore === null) return null;

    const anomalies: string[] = [];

    if (socialVolume !== null) {
      if (socialVolume > 5000) {
        anomalies.push(
          isZh
            ? `社交讨论热度极高（${socialVolume.toLocaleString()}），需关注是否过度狂热`
            : `Social discussion volume is very high (${socialVolume.toLocaleString()}) — monitor for signs of excess euphoria`,
        );
      } else if (socialVolume < 100) {
        anomalies.push(
          isZh
            ? `社交讨论热度极低（${socialVolume.toLocaleString()}），市场关注度不足`
            : `Social discussion volume is very low (${socialVolume.toLocaleString()}) — market attention is minimal`,
        );
      }
    }

    if (sentimentScore !== null) {
      if (sentimentScore > 50) {
        anomalies.push(
          isZh
            ? `情绪读数极度乐观（${sentimentScore.toFixed(1)}），反向风险上升`
            : `Sentiment reading is extremely bullish (${sentimentScore.toFixed(1)}) — reverse risk is elevated`,
        );
      } else if (sentimentScore < -50) {
        anomalies.push(
          isZh
            ? `情绪读数极度悲观（${sentimentScore.toFixed(1)}），可能存在过度恐慌`
            : `Sentiment reading is extremely bearish (${sentimentScore.toFixed(1)}) — possible excessive fear`,
        );
      }
    }

    return anomalies.length > 0 ? anomalies.join('；') : null;
  }

  private detectOnchainAnomaly(
    onchain: ExecutionOutput['data']['onchain']['cexNetflow'],
    isZh: boolean,
  ): string | null {
    const netflow = onchain.netflowUsd;

    if (netflow === null) return null;

    const anomalies: string[] = [];

    if (netflow < -1_000_000_000) {
      anomalies.push(
        isZh
          ? `净流出规模达 ${this.fmt(netflow)}，表明资金持续撤离交易所，潜在买入信号`
          : `Net outflow of ${this.fmt(netflow)} indicates funds are leaving exchanges — potential buy signal`,
      );
    } else if (netflow > 1_000_000_000) {
      anomalies.push(
        isZh
          ? `净流入规模达 ${this.fmt(netflow)}，资金流入交易所可能反映抛压增加`
          : `Net inflow of ${this.fmt(netflow)} suggests increased selling pressure as funds move to exchanges`,
      );
    }

    return anomalies.length > 0 ? anomalies.join('；') : null;
  }

  private detectRiskEscalation(
    alerts: AlertsSnapshot,
    isZh: boolean,
  ): string | null {
    const anomalies: string[] = [];

    if (alerts.riskState === 'emergency' || alerts.riskState === 'elevated') {
      anomalies.push(
        isZh
          ? `风险状态升至 ${alerts.riskState}，需提高警觉`
          : `Risk state elevated to ${alerts.riskState} — stay alert`,
      );
    }

    if (alerts.alertLevel === 'red') {
      anomalies.push(
        isZh
          ? `预警等级达红色，存在 ${alerts.items.filter((i) => i.severity === 'critical').length} 条严重告警`
          : `Alert level is red with ${alerts.items.filter((i) => i.severity === 'critical').length} critical alerts`,
      );
    } else if (
      alerts.alertLevel === 'yellow' &&
      alerts.items.filter((i) => i.severity === 'warning').length > 3
    ) {
      anomalies.push(
        isZh
          ? `预警等级为黄色，存在 ${alerts.items.filter((i) => i.severity === 'warning').length} 条警告项，较平常偏多`
          : `Alert level is yellow with ${alerts.items.filter((i) => i.severity === 'warning').length} warning items — above normal`,
      );
    }

    return anomalies.length > 0 ? anomalies.join('；') : null;
  }

  private buildBurnSummary(
    burns: { totalBurnAmount: number | null; recentBurns: any[] },
    isZh: boolean,
  ): string | null {
    if (burns.totalBurnAmount === null && burns.recentBurns.length === 0) {
      return null;
    }

    const recent = burns.recentBurns.slice(0, 3);
    if (recent.length === 0) {
      return null;
    }

    const burnType = recent[0]?.burnType ?? 'UNKNOWN';
    const frequency =
      recent.length >= 3
        ? isZh
          ? '持续'
          : 'ongoing'
        : isZh
          ? '偶发'
          : 'sporadic';

    return isZh
      ? `${frequency}${burnType === 'PROGRAMMATIC' ? '程序化' : '手动'}销毁，最近 ${recent.length} 次销毁共 ${this.fmt(recent.reduce((sum, b) => sum + (b.amount ?? 0), 0))} 枚`
      : `${frequency} ${burnType.toLowerCase()} burns, recent ${recent.length} events totaling ${this.fmt(recent.reduce((sum, b) => sum + (b.amount ?? 0), 0))} tokens`;
  }

  private buildBuybackSummary(
    buybacks: { totalBuybackAmount: number | null; recentBuybacks: any[] },
    isZh: boolean,
  ): string | null {
    if (
      buybacks.totalBuybackAmount === null &&
      buybacks.recentBuybacks.length === 0
    ) {
      return null;
    }

    const recent = buybacks.recentBuybacks.slice(0, 3);
    if (recent.length === 0) {
      return null;
    }

    const totalSpent = recent.reduce((sum, b) => sum + (b.spentAmount ?? 0), 0);
    const totalTokens = recent.reduce(
      (sum, b) => sum + (b.tokenAmount ?? 0),
      0,
    );
    const avgPrice = totalTokens > 0 ? totalSpent / totalTokens : 0;

    return isZh
      ? `最近 ${recent.length} 次回购共花费 ${this.fmt(totalSpent)} USDC，回购 ${this.fmt(totalTokens)} 枚，均价约 $${avgPrice.toFixed(2)}`
      : `Recent ${recent.length} buybacks spent ${this.fmt(totalSpent)} USDC for ${this.fmt(totalTokens)} tokens, avg ~$${avgPrice.toFixed(2)}`;
  }

  private buildFundraisingSummary(
    fundraising: { totalRaised: number | null; rounds: any[] },
    isZh: boolean,
  ): string | null {
    if (fundraising.totalRaised === null && fundraising.rounds.length === 0) {
      return null;
    }

    const rounds = fundraising.rounds.slice(0, 3);
    if (rounds.length === 0) {
      return null;
    }

    const latestRound = rounds[0];
    const roundName = latestRound?.roundName ?? 'Unknown';
    const amount = latestRound?.amountRaised ?? 0;

    return isZh
      ? `共 ${rounds.length} 轮融资，最近一轮为 ${roundName}，融资 ${this.fmt(amount)}`
      : `${rounds.length} funding rounds, latest: ${roundName} raised ${this.fmt(amount)}`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type {
  AlertsSnapshot,
} from '../../../data/contracts/analyze-contracts';
import {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
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
  execution: ExecutionOutput;
  analysis: AnalysisOutput;
  alerts: AlertsSnapshot;
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
    const scopedQuery = this.buildScopedQuery(
      input.intent,
      execution.identity.symbol,
    );

    const price = execution.data.market.price;
    const technical = execution.data.technical;
    const onchain = execution.data.onchain.cexNetflow;
    const security = execution.data.security;
    const liquidity = execution.data.liquidity;
    const tokenomics = execution.data.tokenomics;
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
      },
      signals: {
        technical: technical.summarySignal,
        technicalDetails: {
          rsi: { value: technical.rsi.value, signal: technical.rsi.signal },
          macd: { value: technical.macd.macd, signal: technical.macd.signal, histogram: technical.macd.histogram },
          ma: { ma7: technical.ma.ma7, ma25: technical.ma.ma25, ma99: technical.ma.ma99, signal: technical.ma.signal },
          boll: { upper: technical.boll.upper, middle: technical.boll.middle, lower: technical.boll.lower, signal: technical.boll.signal },
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
        },
        inflationRate: tokenomics.inflationRate.currentAnnualPct,
        projectName: fundamentals.profile.name,
        projectOneLiner: fundamentals.profile.oneLiner,
        fundamentalsTags: fundamentals.profile.tags,
      },
      decision: {
        verdict: input.analysis.verdict,
        confidence: input.analysis.confidence,
        reason: this.toVisibleReason(input.analysis, input.intent.language === 'zh'),
        buyZone: input.analysis.buyZone,
        sellZone: input.analysis.sellZone,
        evidence: this.filterUserVisibleItems(input.analysis.evidence),
        hardBlocks: input.analysis.hardBlocks,
        tradingStrategy: input.analysis.tradingStrategy,
      },
      insights: {
        summary: this.toVisibleSummary(input.analysis, execution, input.intent.language === 'zh'),
        keyObservations: this.filterUserVisibleItems(input.analysis.keyObservations),
        riskHighlights: this.filterUserVisibleItems(input.analysis.riskHighlights),
        opportunityHighlights: input.analysis.opportunityHighlights,
      },
      alerts: {
        level: input.alerts.alertLevel,
        riskState: input.alerts.riskState,
        redCount: this.filterUserVisibleAlerts(input.alerts).redCount,
        yellowCount: this.filterUserVisibleAlerts(input.alerts).yellowCount,
        topItems: this.filterUserVisibleAlerts(input.alerts).items
          .slice(0, 5)
          .map((item) => `[${item.severity.toUpperCase()}] ${item.code}: ${item.message}`),
      },
      anomalies: {
        priceVolatility: this.detectPriceAnomaly(price, input.intent.language === 'zh'),
        socialActivity: this.detectSocialAnomaly(sentiment, input.intent.language === 'zh'),
        onchainFlow: this.detectOnchainAnomaly(onchain, input.intent.language === 'zh'),
        riskEscalation: this.detectRiskEscalation(input.alerts, input.intent.language === 'zh'),
      },
      tokenomics: {
        burns: {
          totalBurnAmount: tokenomics.burns.totalBurnAmount,
          recentBurnCount: tokenomics.burns.recentBurns.length,
          latestBurnDate: tokenomics.burns.recentBurns[0]?.burnDate ?? null,
          burnSummary: this.buildBurnSummary(tokenomics.burns, input.intent.language === 'zh'),
        },
        buybacks: {
          totalBuybackAmount: tokenomics.buybacks.totalBuybackAmount,
          recentBuybackCount: tokenomics.buybacks.recentBuybacks.length,
          latestBuybackDate: tokenomics.buybacks.recentBuybacks[0]?.buybackDate ?? null,
          buybackSummary: this.buildBuybackSummary(tokenomics.buybacks, input.intent.language === 'zh'),
        },
        fundraising: {
          totalRaised: tokenomics.fundraising.totalRaised,
          roundCount: tokenomics.fundraising.rounds.length,
          latestRoundDate: tokenomics.fundraising.rounds[0]?.fundingDate ?? null,
          fundraisingSummary: this.buildFundraisingSummary(tokenomics.fundraising, input.intent.language === 'zh'),
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

    return {
      report: this.finalizeReport(
        this.composeReport(narrative.data, fallback, input),
        input,
      ),
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

    const verdictLabel = this.toVisibleVerdictLabel(
      advisory.verdict,
      isZh,
    );

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
        isZh ? '核心证据基本完整，这次结论可直接作为当前判断参考。'
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
    const sections = this.buildSectionsFromReportMeta(reportMeta, isZh);

    const body = this.buildNarrativeBody({
      title,
      executiveSummary,
      reportMeta,
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
    const normalizedSections = report.sections.filter(
      (section) => section.heading.trim().length > 0 && section.points.length > 0,
    );
    const reportMeta =
      report.reportMeta ??
      this.toReportMetaFromSections(
        normalizedSections,
        input.intent.language === 'zh',
        report.executiveSummary,
      );
    const fallbackBody = this.buildNarrativeBody({
      title: report.title,
      executiveSummary: report.executiveSummary,
      reportMeta,
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
    return {
      title: this.sanitizeUserFacingText(narrative.title.trim(), fallback.title),
      executiveSummary: this.sanitizeUserFacingText(
        narrative.executiveSummary.trim(),
        fallback.executiveSummary,
      ),
      body: this.sanitizeUserFacingBody(narrative.body.trim(), fallback.body),
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
    disclaimer: string;
  }): string {
    const sections = this.buildSectionsFromReportMeta(
      input.reportMeta,
      /[\u4e00-\u9fff]/.test(input.executiveSummary + input.title),
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
    ].join('\n').trim();
  }

  private fmt(value: number | null): string {
    if (value === null) return 'N/A';
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return value.toFixed(2);
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
  ): Array<{ heading: string; points: string[] }> {
    const sections: Array<{ heading: string; points: string[] }> = [];
    sections.push({
      heading: isZh ? '核心结论' : 'Core Takeaway',
      points: [reportMeta.keyTakeaway],
    });
    if (reportMeta.whyNow.length > 0) {
      sections.push({
        heading: isZh ? '为什么得出这个判断' : 'Why This View',
        points: reportMeta.whyNow,
      });
    }
    if (reportMeta.actionGuidance.length > 0) {
      sections.push({
        heading: isZh ? '现在该怎么做' : 'What To Do Now',
        points: reportMeta.actionGuidance,
      });
    }
    if (reportMeta.keyTriggers.length > 0) {
      sections.push({
        heading: isZh ? '关键触发位' : 'Key Triggers',
        points: reportMeta.keyTriggers,
      });
    }
    const qualityPoints = [
      ...reportMeta.dataQualityNotes,
      ...reportMeta.invalidationSignals,
    ];
    if (qualityPoints.length > 0) {
      sections.push({
        heading: isZh ? '风险与应对' : 'Risks And Response',
        points: qualityPoints,
      });
    }
    return sections;
  }

  private toReportMetaFromSections(
    sections: Array<{ heading: string; points: string[] }>,
    isZh: boolean,
    executiveSummary: string,
  ): ReportMeta {
    const byHeading = new Map(sections.map((section) => [section.heading, section.points]));
    const core = byHeading.get(isZh ? '核心结论' : 'Core Takeaway') ?? [executiveSummary];
    const why = byHeading.get(isZh ? '为什么得出这个判断' : 'Why This View') ?? [];
    const action = byHeading.get(isZh ? '现在该怎么做' : 'What To Do Now') ?? [];
    const triggers = byHeading.get(isZh ? '关键触发位' : 'Key Triggers') ?? [];
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

  private filterUserVisibleAlerts(alerts: AlertsSnapshot): {
    redCount: number;
    yellowCount: number;
    items: AlertsSnapshot['items'];
  } {
    const items = alerts.items.filter(
      (item) =>
        item.code !== 'DATA_DEGRADED' &&
        !this.isHiddenReportText(item.message),
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

  private toVisibleReason(
    analysis: AnalysisOutput,
    isZh: boolean,
  ): string {
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
          ? `预警等级达红色，存在 ${alerts.items.filter(i => i.severity === 'critical').length} 条严重告警`
          : `Alert level is red with ${alerts.items.filter(i => i.severity === 'critical').length} critical alerts`,
      );
    } else if (alerts.alertLevel === 'yellow' && alerts.items.filter(i => i.severity === 'warning').length > 3) {
      anomalies.push(
        isZh
          ? `预警等级为黄色，存在 ${alerts.items.filter(i => i.severity === 'warning').length} 条警告项，较平常偏多`
          : `Alert level is yellow with ${alerts.items.filter(i => i.severity === 'warning').length} warning items — above normal`,
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
    const frequency = recent.length >= 3 ? (isZh ? '持续' : 'ongoing') : (isZh ? '偶发' : 'sporadic');

    return isZh
      ? `${frequency}${burnType === 'PROGRAMMATIC' ? '程序化' : '手动'}销毁，最近 ${recent.length} 次销毁共 ${this.fmt(recent.reduce((sum, b) => sum + (b.amount ?? 0), 0))} 枚`
      : `${frequency} ${burnType.toLowerCase()} burns, recent ${recent.length} events totaling ${this.fmt(recent.reduce((sum, b) => sum + (b.amount ?? 0), 0))} tokens`;
  }

  private buildBuybackSummary(
    buybacks: { totalBuybackAmount: number | null; recentBuybacks: any[] },
    isZh: boolean,
  ): string | null {
    if (buybacks.totalBuybackAmount === null && buybacks.recentBuybacks.length === 0) {
      return null;
    }

    const recent = buybacks.recentBuybacks.slice(0, 3);
    if (recent.length === 0) {
      return null;
    }

    const totalSpent = recent.reduce((sum, b) => sum + (b.spentAmount ?? 0), 0);
    const totalTokens = recent.reduce((sum, b) => sum + (b.tokenAmount ?? 0), 0);
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

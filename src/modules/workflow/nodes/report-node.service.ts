import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AlertsSnapshot,
} from '../../../data/contracts/analyze-contracts';
import {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  ReportOutput,
  WorkflowNodeExecutionMeta,
  reportOutputSchema,
  reportSectionSchema,
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
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

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
      query: input.intent.userQuery,
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
        onchain: onchain.signal,
        sentiment: sentiment.signal,
        securityRisk: security.riskLevel,
        liquidityUsd: liquidity.liquidityUsd,
        liquidityRisk: liquidity.rugpullRiskSignal,
        inflationRate: tokenomics.inflationRate.currentAnnualPct,
        projectName: fundamentals.profile.name,
        projectOneLiner: fundamentals.profile.oneLiner,
        fundamentalsTags: fundamentals.profile.tags,
      },
      decision: {
        verdict: input.analysis.verdict,
        confidence: input.analysis.confidence,
        reason: input.analysis.reason,
        buyZone: input.analysis.buyZone,
        sellZone: input.analysis.sellZone,
        evidence: input.analysis.evidence,
        hardBlocks: input.analysis.hardBlocks,
        tradingStrategy: input.analysis.tradingStrategy,
      },
      insights: {
        summary: input.analysis.summary,
        keyObservations: input.analysis.keyObservations,
        riskHighlights: input.analysis.riskHighlights,
        opportunityHighlights: input.analysis.opportunityHighlights,
        dataQualityNotes: input.analysis.dataQualityNotes,
      },
      alerts: {
        level: input.alerts.alertLevel,
        riskState: input.alerts.riskState,
        redCount: input.alerts.redCount,
        yellowCount: input.alerts.yellowCount,
        topItems: input.alerts.items
          .slice(0, 5)
          .map((item) => `[${item.severity.toUpperCase()}] ${item.code}: ${item.message}`),
      },
      quality: {
        degradedNodes: input.execution.degradedNodes,
        missingEvidence: input.execution.missingEvidence,
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

    const verdictLabel = {
      BUY: isZh ? '买入' : 'BUY',
      SELL: isZh ? '卖出' : 'SELL',
      HOLD: isZh ? '观望' : 'HOLD',
      CAUTION: isZh ? '谨慎' : 'CAUTION',
      INSUFFICIENT_DATA: isZh ? '数据不足' : 'INSUFFICIENT_DATA',
    }[advisory.verdict];

    const title = isZh
      ? `${execution.identity.symbol} 分析报告 - ${verdictLabel}`
      : `${execution.identity.symbol} Analysis - ${verdictLabel}`;

    const priceStr = price.priceUsd !== null
      ? `$${price.priceUsd < 1 ? price.priceUsd.toFixed(6) : price.priceUsd.toFixed(2)}`
      : 'N/A';
    const changeStr = price.change24hPct !== null
      ? `${price.change24hPct >= 0 ? '+' : ''}${price.change24hPct.toFixed(2)}%`
      : 'N/A';
    const liquidityStr = liquidity.liquidityUsd !== null
      ? `$${this.fmt(liquidity.liquidityUsd)}`
      : 'N/A';

    const confidence = advisory.confidence ?? 0;
    const executiveSummary = [
      advisory.reason ?? 'No analysis available',
      isZh
        ? `${execution.identity.symbol} 当前更适合按「${verdictLabel}」理解，整体置信度 ${(confidence * 100).toFixed(0)}%。`
        : `${execution.identity.symbol} is best read as "${verdictLabel}" right now with ${(confidence * 100).toFixed(0)}% confidence.`,
    ].join('\n');

    const sections: Array<{ heading: string; points: string[] }> = [];

    const keySignals: string[] = [];
    keySignals.push(
      isZh
        ? `${execution.identity.symbol} 当前结论为「${verdictLabel}」，核心判断是：${advisory.reason}`
        : `${execution.identity.symbol} is currently rated "${verdictLabel}" because ${advisory.reason}`,
    );
    if (advisory.evidence.length > 0) {
      keySignals.push(
        isZh
          ? `最重要的支撑理由是：${advisory.evidence.slice(0, 2).join('；')}`
          : `The strongest supporting reasons are: ${advisory.evidence.slice(0, 2).join('; ')}`,
      );
    }

    sections.push({
      heading: isZh ? '核心结论' : 'Core Takeaway',
      points: keySignals,
    });

    const marketContextPoints: string[] = [];
    marketContextPoints.push(
      isZh
        ? `技术面整体偏 ${technical.summarySignal}，说明短线并没有形成很顺畅的单边趋势。`
        : `The technical picture is ${technical.summarySignal}, which suggests the short-term trend is not cleanly one-sided.`,
    );
    marketContextPoints.push(
      isZh
        ? `资金流层面表现为 ${onchain.signal.replace('_', ' ')}，市场情绪则偏 ${sentiment.signal}。`
        : `Flow reads as ${onchain.signal.replace('_', ' ')} while sentiment is ${sentiment.signal}.`,
    );
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

    sections.push({
      heading: isZh ? '为什么得出这个判断' : 'Why This View',
      points: marketContextPoints,
    });

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
            ? `更关键的支撑参考先看 ${ts.supportLevels.slice(0, 2).map((item) => item.label).join('、')}。`
            : `The more important support references are ${ts.supportLevels.slice(0, 2).map((item) => item.label).join(', ')}.`,
        );
      }
      if (ts.resistanceLevels.length > 0) {
        strategyPoints.push(
          isZh
            ? `上方主要压力先看 ${ts.resistanceLevels.slice(0, 2).map((item) => item.label).join('、')}。`
            : `The main overhead pressure sits around ${ts.resistanceLevels.slice(0, 2).map((item) => item.label).join(', ')}.`,
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

    sections.push({
      heading: isZh ? '现在该怎么做' : 'What To Do Now',
      points: strategyPoints,
    });

    const qualityPoints: string[] = [];
    if (alerts.redCount > 0) {
      qualityPoints.push(
        isZh ? `存在 ${alerts.redCount} 条严重风险告警。` : `${alerts.redCount} critical risk alerts are active.`,
      );
    }
    if (alerts.yellowCount > 0) {
      qualityPoints.push(
        isZh ? `存在 ${alerts.yellowCount} 条警告项，结论需要配合风控理解。`
        : `${alerts.yellowCount} warning items are active, so the view should be handled with risk controls.`,
      );
    }
    if (execution.degradedNodes.length > 0) {
      qualityPoints.push(
        isZh
          ? `当前仍有降级数据：${execution.degradedNodes.join('、')}，因此结论不是满置信度。`
          : `Some inputs are still degraded: ${execution.degradedNodes.join(', ')}, so confidence should not be treated as full strength.`,
      );
    }
    if (execution.missingEvidence.length > 0) {
      qualityPoints.push(
        isZh
          ? `仍缺少的关键证据有：${execution.missingEvidence.join('、')}。`
          : `Missing evidence remains: ${execution.missingEvidence.join(', ')}.`,
      );
    }
    if (qualityPoints.length === 0) {
      qualityPoints.push(
        isZh ? '核心证据基本完整，这次结论可直接作为当前判断参考。'
        : 'Core evidence is largely intact, so this read can be used as a practical reference.',
      );
    }

    sections.push({
      heading: isZh ? '风险与限制' : 'Risk and Limits',
      points: qualityPoints,
    });

    const conclusionPoints = [
      isZh
        ? `综合现有信息，当前最合理的理解仍然是「${verdictLabel}」。`
        : `Given the available evidence, the most reasonable read remains "${verdictLabel}".`,
      isZh
        ? '如果后续出现更清晰的确认信号或补齐降级数据，再重新评估会更稳妥。'
        : 'A re-check is preferable once confirmation improves or degraded inputs are restored.',
    ];
    sections.push({
      heading: isZh ? '最后一句话' : 'Bottom Line',
      points: conclusionPoints,
    });

    const body = this.buildNarrativeBody({
      title,
      executiveSummary,
      sections,
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。投资有风险，入市需谨慎。'
        : 'This report is for research purposes only and does not constitute investment advice. Please invest responsibly.',
    });

    return {
      title,
      executiveSummary,
      body,
      sections,
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
    const fallbackBody = this.buildNarrativeBody({
      title: report.title,
      executiveSummary: report.executiveSummary,
      sections: normalizedSections,
      disclaimer: report.disclaimer,
    });

    return {
      ...report,
      sections: normalizedSections,
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
      title: narrative.title.trim(),
      executiveSummary: narrative.executiveSummary.trim(),
      body: narrative.body.trim(),
      sections: fallback.sections,
      verdict: input.analysis.verdict,
      confidence: input.analysis.confidence,
      disclaimer: narrative.disclaimer.trim(),
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
    sections: Array<{ heading: string; points: string[] }>;
    disclaimer: string;
  }): string {
    const sectionBlocks = input.sections.map((section) => {
      const narrative = section.points.map((point) => `- ${point}`).join('\n');
      return `${section.heading}\n${narrative}`;
    });

    return [
      input.title,
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
}

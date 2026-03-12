import { Injectable } from '@nestjs/common';
import type { AlertsSnapshot, StrategySnapshot } from '../../core/contracts/analyze-contracts';
import {
  AnalysisOutput,
  analysisOutputSchema,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
} from '../../core/contracts/workflow-contracts';
import { LlmRuntimeService } from './llm-runtime.service';

type AnalyzeInput = {
  intent: IntentOutput;
  plan: PlanOutput;
  execution: ExecutionOutput;
  alerts: AlertsSnapshot;
  strategy: StrategySnapshot;
};

@Injectable()
export class AnalysisNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async analyze(input: AnalyzeInput): Promise<AnalysisOutput> {
    const fallback = this.buildDeterministicAnalysis(input);
    const price = input.execution.data.market.price;
    const onchain = input.execution.data.onchain.cexNetflow;
    const technical = input.execution.data.technical;
    const security = input.execution.data.security;
    const liquidity = input.execution.data.liquidity;
    const tokenomics = input.execution.data.tokenomics;
    const news = input.execution.data.news.items.slice(0, 5).map((item) => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      category: item.category,
      relevanceScore: item.relevanceScore,
    }));

    const context = {
      intent: {
        query: input.intent.userQuery,
        language: input.intent.language,
        taskType: input.intent.taskType,
        objective: input.intent.objective,
        sentimentBias: input.intent.sentimentBias,
        entities: input.intent.entities,
        focusAreas: input.intent.focusAreas,
      },
      analysisQuestions: input.plan.analysisQuestions,
      evidence: {
        price: {
          priceUsd: price.priceUsd,
          change1hPct: price.change1hPct,
          change24hPct: price.change24hPct,
          change7dPct: price.change7dPct,
          change30dPct: price.change30dPct,
          degraded: price.degraded,
        },
        technical: {
          summarySignal: technical.summarySignal,
          rsi: technical.rsi.value,
          macdSignal: technical.macd.signal,
          degraded: technical.degraded,
        },
        onchain: {
          signal: onchain.signal,
          netflowUsd: onchain.netflowUsd,
          degraded: onchain.degraded,
        },
        security: {
          riskLevel: security.riskLevel,
          isHoneypot: security.isHoneypot,
          canTradeSafely: security.canTradeSafely,
          degraded: security.degraded,
        },
        liquidity: {
          liquidityUsd: liquidity.liquidityUsd,
          withdrawalRiskFlag: liquidity.withdrawalRiskFlag,
          rugpullRiskSignal: liquidity.rugpullRiskSignal,
          degraded: liquidity.degraded,
        },
        tokenomics: {
          tokenomicsEvidenceInsufficient: tokenomics.tokenomicsEvidenceInsufficient,
          degraded: tokenomics.degraded,
        },
        news,
      },
      alerts: {
        level: input.alerts.alertLevel,
        redCount: input.alerts.redCount,
        yellowCount: input.alerts.yellowCount,
        items: input.alerts.items,
      },
      strategy: {
        verdict: input.strategy.verdict,
        confidence: input.strategy.confidence,
        reason: input.strategy.reason,
        evidence: input.strategy.evidence,
      },
      dataQuality: {
        degradedNodes: input.execution.degradedNodes,
        missingEvidence: input.execution.missingEvidence,
      },
    };

    return this.llmRuntime.generateStructured({
      nodeName: 'analysis',
      systemPrompt:
        [
          'You are an analysis node for crypto market intelligence.',
          'Return strict JSON only. No markdown and no additional keys.',
          'Compare bullish/bearish evidence, risk constraints, and data quality.',
          'If evidence quality is weak, state it explicitly in dataQualityNotes.',
        ].join(' '),
      userPrompt: [
        'Generate analysis JSON with fields: summary, keyObservations, riskHighlights, opportunityHighlights, dataQualityNotes.',
        'Use this context:',
        JSON.stringify(context),
      ].join('\n'),
      schema: analysisOutputSchema,
      fallback: () => fallback,
    });
  }

  private buildDeterministicAnalysis(input: AnalyzeInput): AnalysisOutput {
    const { execution } = input;
    const price = execution.data.market.price;
    const onchain = execution.data.onchain.cexNetflow;
    const technical = execution.data.technical;

    const keyObservations: string[] = [];
    if (typeof price.change1hPct === 'number') {
      keyObservations.push(`1h price change is ${price.change1hPct.toFixed(2)}%.`);
    }
    if (typeof price.change24hPct === 'number') {
      keyObservations.push(`24h price change is ${price.change24hPct.toFixed(2)}%.`);
    } else {
      keyObservations.push('24h price change is unavailable.');
    }
    if (typeof price.change7dPct === 'number') {
      keyObservations.push(`7d price change is ${price.change7dPct.toFixed(2)}%.`);
    }
    if (typeof price.change30dPct === 'number') {
      keyObservations.push(`30d price change is ${price.change30dPct.toFixed(2)}%.`);
    }
    keyObservations.push(`Technical summary signal: ${technical.summarySignal}.`);
    keyObservations.push(`CEX netflow signal: ${onchain.signal}.`);

    const riskHighlights = input.alerts.items
      .filter((item) => item.severity === 'critical' || item.severity === 'warning')
      .map((item) => `${item.code}: ${item.message}`);

    const opportunityHighlights: string[] = [];
    if (input.strategy.verdict === 'BUY') {
      opportunityHighlights.push('No critical risk block and signals align to upside.');
    } else if (input.strategy.verdict === 'HOLD') {
      opportunityHighlights.push('Mixed market signals suggest waiting for confirmation.');
    } else if (input.strategy.verdict === 'CAUTION') {
      opportunityHighlights.push('Potential setup exists but warning-level risk is active.');
    }

    const dataQualityNotes =
      execution.degradedNodes.length > 0
        ? [`Degraded nodes: ${execution.degradedNodes.join(', ')}.`]
        : ['All executed nodes returned non-degraded snapshots.'];

    const summary =
      input.intent.language === 'zh'
        ? `当前策略结论为 ${input.strategy.verdict}，置信度 ${input.strategy.confidence.toFixed(2)}。`
        : `Current strategy verdict is ${input.strategy.verdict} with confidence ${input.strategy.confidence.toFixed(2)}.`;

    return {
      summary,
      keyObservations,
      riskHighlights,
      opportunityHighlights,
      dataQualityNotes,
    };
  }
}

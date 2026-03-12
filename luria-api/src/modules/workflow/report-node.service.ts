import { Injectable } from '@nestjs/common';
import type { AlertsSnapshot, StrategySnapshot } from '../../core/contracts/analyze-contracts';
import {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  ReportOutput,
  reportOutputSchema,
} from '../../core/contracts/workflow-contracts';
import { LlmRuntimeService } from './llm-runtime.service';

type RenderReportInput = {
  intent: IntentOutput;
  execution: ExecutionOutput;
  analysis: AnalysisOutput;
  alerts: AlertsSnapshot;
  strategy: StrategySnapshot;
};

@Injectable()
export class ReportNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async render(input: RenderReportInput): Promise<ReportOutput> {
    const fallback = this.buildDeterministicReport(input);
    const context = {
      language: input.intent.language,
      query: input.intent.userQuery,
      taskType: input.intent.taskType,
      objective: input.intent.objective,
      sentimentBias: input.intent.sentimentBias,
      entities: input.intent.entities,
      target: {
        symbol: input.execution.identity.symbol,
        chain: input.execution.identity.chain,
      },
      strategy: {
        verdict: input.strategy.verdict,
        confidence: input.strategy.confidence,
        reason: input.strategy.reason,
        buyZone: input.strategy.buyZone,
        sellZone: input.strategy.sellZone,
      },
      alerts: {
        level: input.alerts.alertLevel,
        riskState: input.alerts.riskState,
        redCount: input.alerts.redCount,
        yellowCount: input.alerts.yellowCount,
      },
      analysis: input.analysis,
      execution: {
        degradedNodes: input.execution.degradedNodes,
        missingEvidence: input.execution.missingEvidence,
      },
      outputRules: {
        sectionsAtLeast: 3,
        pointsPerSectionAtLeast: 1,
        disclaimerRequired: true,
      },
    };

    return this.llmRuntime.generateStructured({
      nodeName: 'report',
      systemPrompt:
        [
          'You are a report node for a crypto analysis assistant.',
          'Return strict JSON only. No markdown, no commentary.',
          'Produce a concise but complete final report aligned with strategy and risk constraints.',
          'Use language from context.language.',
        ].join(' '),
      userPrompt: [
        'Generate final report JSON with fields: title, executiveSummary, sections, verdict, confidence, disclaimer.',
        'Use context:',
        JSON.stringify(context),
      ].join('\n'),
      schema: reportOutputSchema,
      fallback: () => fallback,
    });
  }

  private buildDeterministicReport(input: RenderReportInput): ReportOutput {
    const isZh = input.intent.language === 'zh';
    const degradedSummary =
      input.execution.degradedNodes.length > 0
        ? input.execution.degradedNodes.join(', ')
        : isZh
          ? '无'
          : 'none';

    return {
      title: isZh
        ? `${input.execution.identity.symbol} 行情分析报告`
        : `${input.execution.identity.symbol} Market Analysis Report`,
      executiveSummary: input.analysis.summary,
      sections: [
        {
          heading: isZh ? '关键信号' : 'Key Signals',
          points: input.analysis.keyObservations,
        },
        {
          heading: isZh ? '风险提示' : 'Risk Highlights',
          points:
            input.analysis.riskHighlights.length > 0
              ? input.analysis.riskHighlights
              : [isZh ? '未发现新增高风险告警。' : 'No new high-risk alerts were detected.'],
        },
        {
          heading: isZh ? '数据质量' : 'Data Quality',
          points: [
            ...(input.analysis.dataQualityNotes.length > 0
              ? input.analysis.dataQualityNotes
              : [isZh ? '数据质量正常。' : 'Data quality is normal.']),
            isZh
              ? `降级节点: ${degradedSummary}`
              : `Degraded nodes: ${degradedSummary}`,
          ],
        },
      ],
      verdict: input.strategy.verdict,
      confidence: input.strategy.confidence,
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。'
        : 'This report is for research purposes only and is not investment advice.',
    };
  }
}

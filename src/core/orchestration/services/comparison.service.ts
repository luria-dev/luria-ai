import { Injectable } from '@nestjs/common';
import type { IntentOutput, ReportOutput } from '../../../data/contracts/workflow-contracts';
import { buildComparisonReportTemplate } from '../prompts/comparison-report-prompt';
import { scoreWorkflowForComparison } from '../scoring/comparison-scoring';
import { resolveComparisonScoringConfigFromEnv } from '../scoring/comparison-scoring-config';
import type { ComparisonSummary, TargetPipeline } from '../orchestration.types';

@Injectable()
export class ComparisonService {
  shouldBuildComparison(intent: IntentOutput, targetCount: number): boolean {
    return intent.taskType === 'comparison' && targetCount >= 2;
  }

  buildComparisonSummary(
    query: string,
    targets: TargetPipeline[],
  ): ComparisonSummary {
    const scoringConfig = resolveComparisonScoringConfigFromEnv();
    const ranked = targets
      .map((target) => {
        const scoring = scoreWorkflowForComparison(target.pipeline, scoringConfig);
        const score = scoring.total;
        const reasons: string[] = [];
        reasons.push(`strategy=${target.pipeline.strategy.verdict}`);
        reasons.push(
          `confidence=${target.pipeline.strategy.confidence.toFixed(2)}`,
        );
        reasons.push(
          `alerts(red=${target.pipeline.alerts.redCount},yellow=${target.pipeline.alerts.yellowCount})`,
        );
        reasons.push(
          `degradedNodes=${target.pipeline.execution.degradedNodes.length}`,
        );
        reasons.push(
          `scoreBreakdown(verdictBase=${scoring.components.verdictBase},confidence=${scoring.components.confidence},redPenalty=${scoring.components.redAlerts},yellowPenalty=${scoring.components.yellowAlerts},degradedPenalty=${scoring.components.degradedNodes},honeypotPenalty=${scoring.components.honeypot},criticalSecurityPenalty=${scoring.components.criticalSecurity},withdrawalPenalty=${scoring.components.withdrawalRisk})`,
        );
        return {
          targetKey: target.targetKey,
          symbol: target.identity.symbol,
          chain: target.identity.chain,
          verdict: target.pipeline.strategy.verdict,
          confidence: target.pipeline.strategy.confidence,
          score,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0] ?? null;
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const summaryTemplate = buildComparisonReportTemplate({
      language,
      query,
      winner: winner
        ? { symbol: winner.symbol, chain: winner.chain }
        : null,
    });

    return {
      winner,
      ranked,
      summary: summaryTemplate.summary,
    };
  }

  buildMultiTargetBundleReport(
    targets: TargetPipeline[],
    intent: IntentOutput,
  ): ReportOutput {
    const isZh = intent.language === 'zh';
    const points = targets.map((item) => {
      const verdict = item.pipeline.strategy.verdict;
      const confidence = item.pipeline.strategy.confidence.toFixed(2);
      return `${item.identity.symbol} (${item.identity.chain}): ${verdict}, confidence=${confidence}`;
    });

    return {
      title: isZh
        ? '多标的独立分析汇总'
        : 'Multi-Target Independent Analysis Bundle',
      executiveSummary: isZh
        ? '按用户意图执行了多标的独立分析，未触发对比模式。'
        : 'Independent analyses were executed for multiple targets; comparison mode was not requested.',
      sections: [
        {
          heading: isZh ? '执行结果' : 'Execution Results',
          points,
        },
      ],
      verdict: targets[0]?.pipeline.strategy.verdict ?? 'INSUFFICIENT_DATA',
      confidence: Number(
        (targets[0]?.pipeline.strategy.confidence ?? 0).toFixed(2),
      ),
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。'
        : 'This report is for research purposes only and is not investment advice.',
    };
  }

  buildComparisonReport(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): ReportOutput {
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const query = targets[0]?.pipeline.intent.userQuery ?? '';
    const template = buildComparisonReportTemplate({
      language,
      query,
      winner: comparison.winner
        ? { symbol: comparison.winner.symbol, chain: comparison.winner.chain }
        : null,
    });
    const rankedPoints = comparison.ranked.map(
      (item, index) =>
        `${index + 1}. ${item.symbol} (${item.chain}) score=${item.score.toFixed(2)}, verdict=${
          item.verdict
        }, confidence=${item.confidence.toFixed(2)}`,
    );

    const riskPoints = targets.map((target) => {
      const risk = target.pipeline.alerts;
      return `${target.identity.symbol} (${target.identity.chain}) red=${risk.redCount}, yellow=${risk.yellowCount}`;
    });
    const rationalePoints = comparison.ranked.map((item) => {
      const reasons = item.reasons.join('; ');
      return `${item.symbol} (${item.chain}): ${reasons}`;
    });

    const winnerVerdict = comparison.winner?.verdict ?? 'INSUFFICIENT_DATA';
    const winnerConfidence = Number(
      (comparison.winner?.confidence ?? 0).toFixed(2),
    );

    return {
      title: template.title,
      executiveSummary: template.summary,
      sections: [
        {
          heading: template.rankingHeading,
          points:
            rankedPoints.length > 0
              ? rankedPoints
              : [template.noValidTargetsText],
        },
        {
          heading: template.riskHeading,
          points: riskPoints,
        },
        {
          heading: template.rationaleHeading,
          points:
            rationalePoints.length > 0
              ? rationalePoints
              : [template.noValidTargetsText],
        },
        {
          heading: template.conclusionHeading,
          points: [template.summary],
        },
      ],
      verdict: winnerVerdict,
      confidence: winnerConfidence,
      disclaimer: template.disclaimer,
    };
  }
}

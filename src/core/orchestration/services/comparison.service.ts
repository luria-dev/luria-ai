import { Injectable } from '@nestjs/common';
import type {
  AnalysisOutput,
  IntentOutput,
  ReportOutput,
} from '../../../data/contracts/workflow-contracts';
import { buildComparisonReportTemplate } from '../prompts/comparison-report-prompt';
import { scoreWorkflowForComparison } from '../scoring/comparison-scoring';
import { resolveComparisonScoringConfigFromEnv } from '../scoring/comparison-scoring-config';
import type {
  ComparisonRankItem,
  ComparisonSummary,
  TargetPipeline,
} from '../orchestration.types';

@Injectable()
export class ComparisonService {
  private static readonly tieScoreEpsilon = 1e-6;

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
        const scoring = scoreWorkflowForComparison(
          target.pipeline,
          scoringConfig,
        );
        const advisory = target.pipeline.analysis;
        const score = scoring.total;
        const reasons: string[] = [];
        reasons.push(`analysis=${advisory.verdict}`);
        reasons.push(`confidence=${advisory.confidence.toFixed(2)}`);
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
          verdict: advisory.verdict,
          confidence: advisory.confidence,
          score,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    const winner = this.selectWinner(ranked);
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const summaryTemplate = buildComparisonReportTemplate({
      language,
      query,
      winner: winner ? { symbol: winner.symbol, chain: winner.chain } : null,
    });

    return {
      winner,
      ranked,
      summary: summaryTemplate.summary,
    };
  }

  private selectWinner(
    ranked: ComparisonRankItem[],
  ): ComparisonRankItem | null {
    const top = ranked[0];
    if (!top) {
      return null;
    }

    // If best candidate is still insufficient, comparison should not force a winner.
    if (top.verdict === 'INSUFFICIENT_DATA') {
      return null;
    }

    const runnerUp = ranked[1];
    if (
      runnerUp &&
      Math.abs(top.score - runnerUp.score) <= ComparisonService.tieScoreEpsilon
    ) {
      return null;
    }

    return top;
  }

  buildMultiTargetBundleReport(
    targets: TargetPipeline[],
    intent: IntentOutput,
  ): ReportOutput {
    const isZh = intent.language === 'zh';
    const scoringConfig = resolveComparisonScoringConfigFromEnv();
    const ranked = targets
      .map((item) => ({
        item,
        score: scoreWorkflowForComparison(item.pipeline, scoringConfig).total,
      }))
      .sort((a, b) => b.score - a.score);

    const bundleVerdict = this.deriveBundleVerdict(
      targets.map((target) => target.pipeline.analysis),
    );
    const bundleConfidence = this.deriveBundleConfidence(targets);
    const topFocus = ranked[0]?.item ?? targets[0] ?? null;
    const weakTargets = targets.filter(
      (target) =>
        target.pipeline.analysis.verdict === 'SELL' ||
        target.pipeline.analysis.verdict === 'CAUTION',
    );
    const insufficientTargets = targets.filter(
      (target) => target.pipeline.analysis.verdict === 'INSUFFICIENT_DATA',
    );

    const executiveSummary = isZh
      ? this.buildZhBundleSummary(
          targets,
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        )
      : this.buildEnBundleSummary(
          targets,
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        );

    const overviewPoints = isZh
      ? this.buildZhOverviewPoints(
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        )
      : this.buildEnOverviewPoints(
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        );

    const targetPoints = targets.map((target) =>
      isZh
        ? this.buildZhTargetNarrative(target)
        : this.buildEnTargetNarrative(target),
    );

    const actionPoints = isZh
      ? this.buildZhActionPoints(
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        )
      : this.buildEnActionPoints(
          topFocus?.identity.symbol ?? null,
          weakTargets.map((target) => target.identity.symbol),
          insufficientTargets.map((target) => target.identity.symbol),
        );

    const qualityPoints = targets.map((target) =>
      this.buildQualityLine(target, isZh),
    );

    const sections = [
      {
        heading: isZh ? '整体判断' : 'Overall Read',
        points: overviewPoints,
      },
      {
        heading: isZh ? '逐个标的结论' : 'Per-Asset Conclusions',
        points: targetPoints,
      },
      {
        heading: isZh ? '操作建议' : 'Action Plan',
        points: actionPoints,
      },
      {
        heading: isZh ? '数据质量' : 'Data Quality',
        points: qualityPoints,
      },
    ];

    return {
      title: isZh
        ? '多标的篮子分析'
        : 'Multi-Asset Basket Review',
      executiveSummary,
      body: this.buildNarrativeBody({
        intro: executiveSummary,
        sections,
        disclaimer: isZh
          ? '本报告仅供研究参考，不构成投资建议。'
          : 'This report is for research purposes only and is not investment advice.',
      }),
      sections,
      verdict: bundleVerdict,
      confidence: bundleConfidence,
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
      body: [
        template.summary,
        '',
        `${template.rankingHeading}\n${rankedPoints.join('\n')}`,
        '',
        `${template.riskHeading}\n${riskPoints.join('\n')}`,
        '',
        `${template.rationaleHeading}\n${rationalePoints.join('\n')}`,
        '',
        template.disclaimer,
      ].join('\n'),
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

  private deriveBundleVerdict(
    analyses: AnalysisOutput[],
  ): ReportOutput['verdict'] {
    const verdicts = analyses.map((analysis) => analysis.verdict);
    if (verdicts.every((verdict) => verdict === 'INSUFFICIENT_DATA')) {
      return 'INSUFFICIENT_DATA';
    }
    if (verdicts.some((verdict) => verdict === 'SELL')) {
      return 'CAUTION';
    }
    if (verdicts.some((verdict) => verdict === 'CAUTION')) {
      return 'CAUTION';
    }
    if (verdicts.some((verdict) => verdict === 'BUY')) {
      return 'HOLD';
    }
    return 'HOLD';
  }

  private deriveBundleConfidence(targets: TargetPipeline[]): number {
    if (targets.length === 0) {
      return 0.35;
    }
    const avg =
      targets.reduce(
        (sum, target) => sum + target.pipeline.analysis.confidence,
        0,
      ) / targets.length;
    return Number(avg.toFixed(2));
  }

  private buildZhBundleSummary(
    targets: TargetPipeline[],
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string {
    const focusPart = topFocus
      ? `当前更值得继续跟踪的是 ${topFocus}。`
      : '当前没有单一标的形成明确优先级。';
    const weakPart =
      weakTargets.length > 0
        ? `偏弱或需要收缩风险的标的是 ${weakTargets.join('、')}。`
        : '当前没有出现需要明显减仓的标的。';
    const insufficientPart =
      insufficientTargets.length > 0
        ? `${insufficientTargets.join('、')} 仍有关键证据缺口，暂不适合给强方向。`
        : '主要标的均已形成可读结论。';
    return `本次对 ${targets
      .map((target) => target.identity.symbol)
      .join('、')} 分别做了独立分析。${focusPart}${weakPart}${insufficientPart}`;
  }

  private buildEnBundleSummary(
    targets: TargetPipeline[],
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string {
    const focusPart = topFocus
      ? `${topFocus} is the name worth monitoring most closely right now.`
      : 'No single asset stands out as the clear priority.';
    const weakPart =
      weakTargets.length > 0
        ? `The weaker or more defensive names are ${weakTargets.join(', ')}.`
        : 'No name currently requires obvious forced de-risking.';
    const insufficientPart =
      insufficientTargets.length > 0
        ? `${insufficientTargets.join(', ')} still lack enough evidence for a strong directional call.`
        : 'All names produced readable conclusions.';
    return `Independent reviews were completed for ${targets
      .map((target) => target.identity.symbol)
      .join(', ')}. ${focusPart} ${weakPart} ${insufficientPart}`;
  }

  private buildZhOverviewPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`当前更适合继续跟踪 ${topFocus}，其综合可读性和参考价值相对更高。`);
    }
    if (weakTargets.length > 0) {
      points.push(`${weakTargets.join('、')} 的风险信号更重，当前应以防守和收缩风险为先。`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`${insufficientTargets.join('、')} 关键证据仍不完整，现阶段不宜给过强结论。`);
    }
    if (points.length === 0) {
      points.push('当前多标的信号整体分化不大，更适合继续观察确认。');
    }
    return points;
  }

  private buildEnOverviewPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`${topFocus} currently offers the clearest read among the basket.`);
    }
    if (weakTargets.length > 0) {
      points.push(`${weakTargets.join(', ')} carry heavier risk pressure and should be handled more defensively.`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`${insufficientTargets.join(', ')} still lack enough evidence for a strong call.`);
    }
    if (points.length === 0) {
      points.push('Signals are broadly mixed across the basket, so further confirmation is preferable.');
    }
    return points;
  }

  private buildZhTargetNarrative(target: TargetPipeline): string {
    const analysis = target.pipeline.analysis;
    const verdictLabel = this.toZhVerdict(analysis.verdict);
    const keyReason =
      analysis.evidence[0] ??
      analysis.reason;
    const action = this.toZhAction(analysis.verdict);
    return `${target.identity.symbol}：当前结论为${verdictLabel}（${Math.round(
      analysis.confidence * 100,
    )}%）。核心原因是“${keyReason}”。${action}`;
  }

  private buildEnTargetNarrative(target: TargetPipeline): string {
    const analysis = target.pipeline.analysis;
    const keyReason = analysis.evidence[0] ?? analysis.reason;
    const action = this.toEnAction(analysis.verdict);
    return `${target.identity.symbol}: ${analysis.verdict} (${Math.round(
      analysis.confidence * 100,
    )}%). Core reason: "${keyReason}". ${action}`;
  }

  private buildZhActionPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`若要继续投入精力，优先看 ${topFocus}，再决定是否需要更细的入场/离场讨论。`);
    }
    if (weakTargets.length > 0) {
      points.push(`对 ${weakTargets.join('、')}，当前更适合防守处理，避免激进加仓。`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`对 ${insufficientTargets.join('、')}，先补齐关键证据，再讨论明确方向。`);
    }
    if (points.length === 0) {
      points.push('当前更适合保持观察，等待更清晰的确认信号。');
    }
    return points;
  }

  private buildEnActionPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`If more attention is needed, start with ${topFocus} before going deeper on entries or exits.`);
    }
    if (weakTargets.length > 0) {
      points.push(`For ${weakTargets.join(', ')}, a defensive posture is more appropriate than aggressive adding.`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`For ${insufficientTargets.join(', ')}, restore missing evidence before pushing for a directional trade plan.`);
    }
    if (points.length === 0) {
      points.push('Observation remains more appropriate until cleaner confirmation appears.');
    }
    return points;
  }

  private buildQualityLine(target: TargetPipeline, isZh: boolean): string {
    const degraded = target.pipeline.execution.degradedNodes;
    const missing = target.pipeline.execution.missingEvidence;
    if (isZh) {
      if (degraded.length === 0 && missing.length === 0) {
        return `${target.identity.symbol}：核心数据完整，可直接阅读结论。`;
      }
      const degradedPart =
        degraded.length > 0 ? `降级节点 ${degraded.join('、')}` : null;
      const missingPart =
        missing.length > 0 ? `缺失证据 ${missing.join('、')}` : null;
      return `${target.identity.symbol}：${[degradedPart, missingPart]
        .filter(Boolean)
        .join('，')}。`;
    }

    if (degraded.length === 0 && missing.length === 0) {
      return `${target.identity.symbol}: core data is intact.`;
    }
    const degradedPart =
      degraded.length > 0 ? `degraded nodes ${degraded.join(', ')}` : null;
    const missingPart =
      missing.length > 0 ? `missing evidence ${missing.join(', ')}` : null;
    return `${target.identity.symbol}: ${[degradedPart, missingPart]
      .filter(Boolean)
      .join(', ')}.`;
  }

  private buildNarrativeBody(input: {
    intro: string;
    sections: Array<{ heading: string; points: string[] }>;
    disclaimer: string;
  }): string {
    const sectionBlocks = input.sections.map((section) => {
      const narrative = section.points.map((point) => `- ${point}`).join('\n');
      return `${section.heading}\n${narrative}`;
    });

    return [input.intro, '', ...sectionBlocks.flatMap((block) => ['', block]), '', input.disclaimer]
      .join('\n')
      .trim();
  }

  private toZhVerdict(verdict: ReportOutput['verdict']): string {
    const mapping: Record<ReportOutput['verdict'], string> = {
      BUY: '买入',
      SELL: '卖出',
      HOLD: '观望',
      CAUTION: '谨慎',
      INSUFFICIENT_DATA: '数据不足',
    };
    return mapping[verdict];
  }

  private toZhAction(verdict: ReportOutput['verdict']): string {
    const mapping: Record<ReportOutput['verdict'], string> = {
      BUY: '当前可以继续跟踪回踩与确认信号，再考虑执行。',
      SELL: '当前更适合减仓、收缩风险，而不是继续进攻。',
      HOLD: '当前更适合继续观察，不急于做重决策。',
      CAUTION: '当前应先控风险，再等待更清晰的确认。',
      INSUFFICIENT_DATA: '当前先不要强行下方向结论。',
    };
    return mapping[verdict];
  }

  private toEnAction(verdict: ReportOutput['verdict']): string {
    const mapping: Record<ReportOutput['verdict'], string> = {
      BUY: 'Watch for confirmation before committing more capital.',
      SELL: 'Reducing exposure is more appropriate than pressing offense.',
      HOLD: 'Observation is more appropriate than forcing a decision.',
      CAUTION: 'Prioritize risk control before seeking new entries.',
      INSUFFICIENT_DATA: 'Avoid forcing a directional view for now.',
    };
    return mapping[verdict];
  }
}

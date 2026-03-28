import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AnalysisOutput,
  IntentOutput,
  ReportMeta,
  ReportOutput,
  WorkflowNodeExecutionMeta,
} from '../../../data/contracts/workflow-contracts';
import { LlmRuntimeService } from '../../../modules/workflow/runtime/llm-runtime.service';
import { buildComparisonReportTemplate } from '../prompts/comparison-report-prompt';
import { scoreWorkflowForComparison } from '../scoring/comparison-scoring';
import { resolveComparisonScoringConfigFromEnv } from '../scoring/comparison-scoring-config';
import type {
  ComparisonRankItem,
  ComparisonSummary,
  TargetPipeline,
} from '../orchestration.types';

const comparisonReportNarrativeSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string().min(1),
  body: z.string().min(1),
  disclaimer: z.string().min(1),
});

type ComparisonReportNarrative = z.infer<
  typeof comparisonReportNarrativeSchema
>;

@Injectable()
export class ComparisonService {
  private static readonly tieScoreEpsilon = 1e-6;

  constructor(private readonly llmRuntime: LlmRuntimeService) {}

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
    const weakSymbols = weakTargets.map((target) => target.identity.symbol);
    const insufficientSymbols = insufficientTargets.map(
      (target) => target.identity.symbol,
    );
    const preferredSymbols =
      topFocus &&
      !weakSymbols.includes(topFocus.identity.symbol) &&
      !insufficientSymbols.includes(topFocus.identity.symbol)
        ? [topFocus.identity.symbol]
        : [];
    const secondarySymbols = targets
      .map((target) => target.identity.symbol)
      .filter(
        (symbol) =>
          !preferredSymbols.includes(symbol) &&
          !weakSymbols.includes(symbol) &&
          !insufficientSymbols.includes(symbol),
      );

    const executiveSummary = isZh
      ? this.buildZhBundleSummary(
          targets,
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        )
      : this.buildEnBundleSummary(
          targets,
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        );

    const overviewPoints = isZh
      ? this.buildZhOverviewPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        )
      : this.buildEnOverviewPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        );

    const targetPoints = targets.map((target) =>
      isZh
        ? this.buildZhTargetNarrative(target)
        : this.buildEnTargetNarrative(target),
    );

    const allocationPoints = isZh
      ? this.buildZhAllocationPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        )
      : this.buildEnAllocationPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        );
    const scenarioPoints = isZh
      ? this.buildZhBundleScenarioPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        )
      : this.buildEnBundleScenarioPoints(
          topFocus?.identity.symbol ?? null,
          weakSymbols,
          insufficientSymbols,
        );

    const qualityPoints = [
      ...targets.map((target) => this.buildQualityLine(target, isZh)),
      ...(isZh
        ? this.buildZhBundleInvalidationPoints(
            topFocus?.identity.symbol ?? null,
            weakSymbols,
            insufficientSymbols,
          )
        : this.buildEnBundleInvalidationPoints(
            topFocus?.identity.symbol ?? null,
            weakSymbols,
            insufficientSymbols,
          )),
    ];

    const reportMeta: ReportMeta = {
      keyTakeaway: overviewPoints[0] ?? executiveSummary,
      whyNow: overviewPoints.slice(1),
      actionGuidance: [],
      keyTriggers: [],
      invalidationSignals: qualityPoints,
      dataQualityNotes: [],
      allocationGuidance: {
        summary: allocationPoints[0] ?? executiveSummary,
        preferred: preferredSymbols,
        secondary: secondarySymbols,
        avoided: weakSymbols,
        weights: this.buildAllocationWeights(
          topFocus?.identity.symbol ?? null,
          targets.map((target) => target.identity.symbol),
          weakSymbols,
          insufficientSymbols,
        ),
      },
      scenarioMap: [
        {
          scenario: 'bull',
          summary: scenarioPoints[0] ?? (isZh ? '优先跟踪最强标的的延续性。' : 'Prioritize continuation in the strongest name.'),
          trigger: scenarioPoints[1] ?? (isZh ? '需要更清晰确认。' : 'Cleaner confirmation is required.'),
        },
        {
          scenario: 'base',
          summary: scenarioPoints[2] ?? (isZh ? '维持分化，继续按优先级观察。' : 'Expect continued dispersion and monitor by priority.'),
          trigger: scenarioPoints[3] ?? (isZh ? '若证据没有明显改善，则不宜激进扩张。' : 'If evidence does not improve, avoid aggressive expansion.'),
        },
      ],
    };
    const sections = this.buildSectionsFromReportMeta(reportMeta, isZh);

    return {
      title: isZh
        ? '多标的篮子分析'
        : 'Multi-Asset Basket Review',
      executiveSummary,
      body: this.buildNarrativeBody({
        title: isZh
          ? '多标的篮子分析'
          : 'Multi-Asset Basket Review',
        intro: executiveSummary,
        reportMeta,
        disclaimer: isZh
          ? '本报告仅供研究参考，不构成投资建议。'
          : 'This report is for research purposes only and is not investment advice.',
      }),
      sections,
      reportMeta,
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
    const isZh = language === 'zh';
    const query = targets[0]?.pipeline.intent.userQuery ?? '';
    const template = buildComparisonReportTemplate({
      language,
      query,
      winner: comparison.winner
        ? { symbol: comparison.winner.symbol, chain: comparison.winner.chain }
        : null,
    });
    const topRanked = comparison.ranked[0] ?? null;
    const runnerUp = comparison.ranked[1] ?? null;
    const winnerVerdict = comparison.winner?.verdict ?? 'INSUFFICIENT_DATA';
    const winnerConfidence = Number(
      (comparison.winner?.confidence ?? 0).toFixed(2),
    );
    const overallPoints = isZh
      ? this.buildZhComparisonOverview(comparison, topRanked, runnerUp)
      : this.buildEnComparisonOverview(comparison, topRanked, runnerUp);
    const whyPoints = isZh
      ? this.buildZhComparisonWhy(comparison, topRanked, runnerUp)
      : this.buildEnComparisonWhy(comparison, topRanked, runnerUp);
    const targetPoints = targets.map((target) =>
      isZh
        ? this.buildZhTargetNarrative(target)
        : this.buildEnTargetNarrative(target),
    );
    const allocationPoints = isZh
      ? this.buildZhComparisonAllocation(comparison, topRanked, runnerUp)
      : this.buildEnComparisonAllocation(comparison, topRanked, runnerUp);
    const scenarioPoints = isZh
      ? this.buildZhComparisonScenarios(targets, comparison, topRanked, runnerUp)
      : this.buildEnComparisonScenarios(targets, comparison, topRanked, runnerUp);
    const qualityPoints = isZh
      ? this.buildZhComparisonQuality(targets, comparison)
      : this.buildEnComparisonQuality(targets, comparison);
    const reportMeta: ReportMeta = {
      keyTakeaway: overallPoints[0] ?? template.summary,
      whyNow: [...overallPoints.slice(1), ...whyPoints, ...targetPoints],
      actionGuidance: [],
      keyTriggers: [],
      invalidationSignals: qualityPoints,
      dataQualityNotes: [],
      allocationGuidance: {
        summary: allocationPoints[0] ?? template.summary,
        preferred: comparison.winner ? [comparison.winner.symbol] : [],
        secondary: comparison.winner && runnerUp ? [runnerUp.symbol] : [],
        avoided: comparison.ranked
          .filter((item) => item.verdict === 'SELL' || item.verdict === 'CAUTION')
          .map((item) => item.symbol),
        weights: this.buildComparisonWeights(comparison, runnerUp),
      },
      scenarioMap: this.buildComparisonScenarioMap(
        targets,
        comparison,
        scenarioPoints,
        isZh,
      ),
    };
    const sections = this.buildSectionsFromReportMeta(reportMeta, isZh);

    return {
      title: template.title,
      executiveSummary: template.summary,
      body: this.buildNarrativeBody({
        title: template.title,
        intro: template.summary,
        reportMeta,
        disclaimer: template.disclaimer,
      }),
      sections,
      reportMeta,
      verdict: winnerVerdict,
      confidence: winnerConfidence,
      disclaimer: template.disclaimer,
    };
  }

  async buildComparisonReportWithMeta(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): Promise<{
    report: ReportOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    const fallback = this.buildComparisonReport(targets, comparison);
    const prompts = this.buildComparisonReportPrompts(targets, comparison);
    const narrative = await this.llmRuntime.generateStructuredWithMeta({
      nodeName: 'report',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: comparisonReportNarrativeSchema,
      fallback: () => this.toNarrativeFallback(fallback),
      correctionGuidance: [
        'The `body` field must be a single Markdown string, not an array.',
        'Do not wrap body content as a JSON array of paragraphs.',
        'Return exactly one JSON object with string fields only.',
      ],
    });

    return {
      report: {
        ...fallback,
        title: narrative.data.title,
        executiveSummary: narrative.data.executiveSummary,
        body: narrative.data.body,
        disclaimer: narrative.data.disclaimer,
      },
      meta: narrative.meta,
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

  private toNarrativeFallback(
    report: ReportOutput,
  ): ComparisonReportNarrative {
    return {
      title: report.title,
      executiveSummary: report.executiveSummary,
      body: report.body,
      disclaimer: report.disclaimer,
    };
  }

  private buildComparisonReportPrompts(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): { systemPrompt: string; userPrompt: string } {
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const isZh = language === 'zh';
    const query = targets[0]?.pipeline.intent.userQuery ?? '';
    const fallback = this.buildComparisonReport(targets, comparison);

    const systemPrompt = `
You are an expert crypto research editor writing the final user-facing comparison report.

## Goal
Write one clear comparison report for multiple crypto assets using the supplied ranking result and per-target analysis.

## Required Behavior
- Use ${isZh ? 'Chinese (中文)' : 'English'}
- Write for users who prefer conclusions and reasoning over raw score dumps
- Keep the report readable and decisive, but do not invent certainty
- If the comparison winner is null or evidence is degraded, explain why no final winner is declared
- Do not output a mechanical scoring table unless it is necessary for clarity
- Select only the most decision-relevant numbers and risks
- Respect the supplied comparison result; do not override the winner logic
- Return only valid JSON with: title, executiveSummary, body, disclaimer
- The field "body" must be one Markdown string, not an array or object

## Body Structure
- Use short titled paragraphs in the body
- Cover: overall conclusion, why the comparison lands this way, per-target takeaways, action or allocation guidance, and risks or data quality
`.trim();

    const rankedLines = comparison.ranked.map(
      (item, index) =>
        `${index + 1}. ${item.symbol} (${item.chain}) | verdict=${item.verdict} | confidence=${item.confidence.toFixed(2)} | score=${item.score.toFixed(2)} | reasons=${item.reasons.join('; ')}`,
    );

    const targetLines = targets.map((target) => {
      const analysis = target.pipeline.analysis;
      const alerts = target.pipeline.alerts;
      const execution = target.pipeline.execution;
      const price = execution.data.market.price;
      return [
        `- ${target.identity.symbol} (${target.identity.chain})`,
        `  verdict=${analysis.verdict}, confidence=${analysis.confidence.toFixed(2)}`,
        `  reason=${analysis.reason}`,
        `  summary=${analysis.summary}`,
        `  keyObservations=${analysis.keyObservations.join(' | ') || 'N/A'}`,
        `  riskHighlights=${analysis.riskHighlights.join(' | ') || 'N/A'}`,
        `  dataQualityNotes=${analysis.dataQualityNotes.join(' | ') || 'N/A'}`,
        `  degradedNodes=${execution.degradedNodes.join(', ') || 'None'}`,
        `  missingEvidence=${execution.missingEvidence.join(', ') || 'None'}`,
        `  alerts(red=${alerts.redCount}, yellow=${alerts.yellowCount})`,
        `  market(price=${price.priceUsd ?? 'N/A'}, 24h=${price.change24hPct ?? 'N/A'}%, 7d=${price.change7dPct ?? 'N/A'}%, volume=${price.totalVolume24hUsd ?? 'N/A'})`,
      ].join('\n');
    });

    const userPrompt = `
## User Query
${query}

## Comparison Result
- Winner: ${comparison.winner ? `${comparison.winner.symbol} (${comparison.winner.chain})` : 'NONE'}
- Summary: ${comparison.summary}
- Deterministic fallback report:
${fallback.body}

## Ranking
${rankedLines.join('\n') || 'N/A'}

## Per-Target Analysis
${targetLines.join('\n\n')}

## Writing Task
Produce the final comparison report for the user.
The report should sound like a concise analyst note, not a raw scoring export.
If no winner can be declared, explain the blocking factors and what to monitor next.
Return "body" as one Markdown string.
`.trim();

    return { systemPrompt, userPrompt };
  }

  private buildZhComparisonOverview(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    if (!topRanked) {
      return ['当前没有可用于比较的有效标的，因此无法形成对比结论。'];
    }

    if (!comparison.winner) {
      const reasons: string[] = [];
      if (topRanked.verdict === 'INSUFFICIENT_DATA') {
        reasons.push('领先标的本身也处于“数据不足”，无法支撑强结论。');
      }
      if (
        runnerUp &&
        Math.abs(topRanked.score - runnerUp.score) <= ComparisonService.tieScoreEpsilon
      ) {
        reasons.push(`头部标的之间差距过小，当前不值得强行分出胜负。`);
      }
      return [
        `当前无法在 ${comparison.ranked.map((item) => item.symbol).join('、')} 之间给出明确胜者。`,
        ...(reasons.length > 0
          ? reasons
          : ['现阶段更合理的处理方式是承认分歧，继续等待更清晰的确认信号。']),
      ];
    }

    const leadText = runnerUp
      ? `${comparison.winner.symbol} 相比 ${runnerUp.symbol} 更占优。`
      : `${comparison.winner.symbol} 是当前唯一形成可读优势的标的。`;
    return [
      `本轮对比里，${comparison.winner.symbol} 是当前更强的一侧。`,
      leadText,
    ];
  }

  private buildEnComparisonOverview(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    if (!topRanked) {
      return ['No valid targets were available for comparison, so no conclusion can be formed.'];
    }

    if (!comparison.winner) {
      const reasons: string[] = [];
      if (topRanked.verdict === 'INSUFFICIENT_DATA') {
        reasons.push('The leading name still sits in insufficient-data territory, so a strong call would be forced.');
      }
      if (
        runnerUp &&
        Math.abs(topRanked.score - runnerUp.score) <= ComparisonService.tieScoreEpsilon
      ) {
        reasons.push('The gap between the top names is too small to justify a decisive winner.');
      }
      return [
        `No clear winner can be declared across ${comparison.ranked.map((item) => item.symbol).join(', ')} right now.`,
        ...(reasons.length > 0
          ? reasons
          : ['The more disciplined stance is to wait for cleaner confirmation instead of forcing separation.']),
      ];
    }

    const leadText = runnerUp
      ? `${comparison.winner.symbol} currently has the clearer edge over ${runnerUp.symbol}.`
      : `${comparison.winner.symbol} is the only name with a readable edge right now.`;
    return [
      `${comparison.winner.symbol} is the stronger side in this comparison.`,
      leadText,
    ];
  }

  private buildZhComparisonWhy(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    const points: string[] = [];
    if (topRanked) {
      points.push(
        `${topRanked.symbol} 当前判断为「${this.toZhVerdict(topRanked.verdict)}」，置信度约 ${Math.round(
          topRanked.confidence * 100,
        )}%。`,
      );
      if (topRanked.reasons.length > 0) {
        points.push(`排序的核心依据是：${this.humanizeComparisonReasons(topRanked.reasons, 'zh')}`);
      }
    }
    if (runnerUp) {
      points.push(
        `${runnerUp.symbol} 仍然具备可比性，但当前综合信号略弱于 ${topRanked?.symbol ?? '领先标的'}。`,
      );
    }
    if (points.length === 0) {
      points.push('当前缺少足够的比较证据，无法解释相对强弱。');
    }
    return points;
  }

  private buildEnComparisonWhy(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    const points: string[] = [];
    if (topRanked) {
      points.push(
        `${topRanked.symbol} currently carries a ${topRanked.verdict} read with about ${Math.round(
          topRanked.confidence * 100,
        )}% confidence.`,
      );
      if (topRanked.reasons.length > 0) {
        points.push(`The ranking mainly comes from ${this.humanizeComparisonReasons(topRanked.reasons, 'en')}.`);
      }
    }
    if (runnerUp) {
      points.push(
        `${runnerUp.symbol} remains competitive, but its combined signal quality is still weaker than ${topRanked?.symbol ?? 'the leading name'}.`,
      );
    }
    if (points.length === 0) {
      points.push('The comparison lacks enough evidence to explain relative strength cleanly.');
    }
    return points;
  }

  private buildZhComparisonAction(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
  ): string[] {
    if (!comparison.winner || !topRanked) {
      return [
        '当前不建议基于这次对比强行做胜负配置，更适合继续观察后续确认。',
        '如果后续数据修复或领先差距扩大，再重新评估配置比例。',
      ];
    }

    const points = [
      `如果一定要在本轮比较里做优先级，先把注意力放在 ${comparison.winner.symbol}。`,
      `${comparison.winner.symbol} 适合作为继续跟踪和细化执行计划的第一顺位，其他标的暂时放在第二优先级。`,
    ];
    if (topRanked.verdict === 'BUY') {
      points.push('即便相对更强，也仍应等待更好的入场确认，而不是把“相对优势”误读成“无条件进场”。');
    }
    return points;
  }

  private buildEnComparisonAction(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
  ): string[] {
    if (!comparison.winner || !topRanked) {
      return [
        'Do not force an allocation winner off this comparison alone; continued observation is more appropriate.',
        'Reassess once degraded inputs recover or the lead becomes more decisive.',
      ];
    }

    const points = [
      `If capital or attention must be prioritized, start with ${comparison.winner.symbol}.`,
      `${comparison.winner.symbol} deserves first-pass monitoring and execution planning, while the other names stay secondary.`,
    ];
    if (topRanked.verdict === 'BUY') {
      points.push('Relative strength still should not be misread as unconditional entry permission.');
    }
    return points;
  }

  private buildZhComparisonQuality(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): string[] {
    const points = targets.map((target) => this.buildQualityLine(target, true));
    const redTargets = targets
      .filter((target) => target.pipeline.alerts.redCount > 0)
      .map((target) => target.identity.symbol);
    const yellowTargets = targets
      .filter((target) => target.pipeline.alerts.yellowCount > 0)
      .map((target) => target.identity.symbol);

    if (redTargets.length > 0) {
      points.push(`红色风险提示出现在 ${redTargets.join('、')}，这些标的不能按正常乐观情景解读。`);
    } else if (yellowTargets.length > 0) {
      points.push(`当前主要是黄色预警，集中在 ${yellowTargets.join('、')}，说明结论可读但需要保留谨慎。`);
    }
    points.push(
      comparison.winner
        ? `若 ${comparison.winner.symbol} 的领先优势消失，或主要降级数据长期未修复，这次配置优先级就需要重排。`
        : '若后续仍无法形成明确领先者，就不应把这次对比结果当成强配置依据。',
    );

    return points;
  }

  private buildEnComparisonQuality(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): string[] {
    const points = targets.map((target) => this.buildQualityLine(target, false));
    const redTargets = targets
      .filter((target) => target.pipeline.alerts.redCount > 0)
      .map((target) => target.identity.symbol);
    const yellowTargets = targets
      .filter((target) => target.pipeline.alerts.yellowCount > 0)
      .map((target) => target.identity.symbol);

    if (redTargets.length > 0) {
      points.push(`Red alerts are present on ${redTargets.join(', ')}, so those names should not be read through a normal bullish lens.`);
    } else if (yellowTargets.length > 0) {
      points.push(`Current risk is mostly yellow-alert level across ${yellowTargets.join(', ')}, which keeps the view readable but not carefree.`);
    }
    points.push(
      comparison.winner
        ? `If ${comparison.winner.symbol} loses its edge or degraded inputs remain unresolved, the current allocation priority should be revisited.`
        : 'If no clear leader emerges after more data arrives, this comparison should not be used as a strong allocation signal.',
    );

    return points;
  }

  private humanizeComparisonReasons(
    reasons: string[],
    language: 'zh' | 'en',
  ): string {
    const verdictReason = reasons.find((reason) => reason.startsWith('analysis='));
    const confidenceReason = reasons.find((reason) => reason.startsWith('confidence='));
    const alertReason = reasons.find((reason) => reason.startsWith('alerts('));
    const degradedReason = reasons.find((reason) => reason.startsWith('degradedNodes='));
    const parts: string[] = [];

    if (verdictReason) {
      const verdict = verdictReason.split('=')[1] ?? 'UNKNOWN';
      parts.push(
        language === 'zh'
          ? `分析结论偏向「${this.toZhVerdict(verdict as ReportOutput['verdict'])}」`
          : `its analysis verdict leaning ${verdict}`,
      );
    }
    if (confidenceReason) {
      const confidence = confidenceReason.split('=')[1] ?? '0';
      parts.push(
        language === 'zh'
          ? `置信度约为 ${Math.round(Number(confidence) * 100)}%`
          : `confidence near ${Math.round(Number(confidence) * 100)}%`,
      );
    }
    if (alertReason) {
      const match = alertReason.match(/red=(\d+),yellow=(\d+)/);
      if (match) {
        parts.push(
          language === 'zh'
            ? `风险提示为红 ${match[1]} / 黄 ${match[2]}`
            : `alert load of red ${match[1]} / yellow ${match[2]}`,
        );
      }
    }
    if (degradedReason) {
      const count = Number(degradedReason.split('=')[1] ?? '0');
      if (count > 0) {
        parts.push(
          language === 'zh'
            ? `同时存在 ${count} 个降级数据节点`
            : `with ${count} degraded data nodes still in play`,
        );
      }
    }

    if (parts.length === 0) {
      return language === 'zh' ? '综合信号相对更完整' : 'a relatively more complete combined signal set';
    }

    return language === 'zh' ? parts.join('，') : parts.join(', ');
  }

  private buildEnTargetNarrative(target: TargetPipeline): string {
    const analysis = target.pipeline.analysis;
    const keyReason = analysis.evidence[0] ?? analysis.reason;
    const action = this.toEnAction(analysis.verdict);
    return `${target.identity.symbol}: ${analysis.verdict} (${Math.round(
      analysis.confidence * 100,
    )}%). Core reason: "${keyReason}". ${action}`;
  }

  private buildZhAllocationPoints(
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

  private buildEnAllocationPoints(
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
    title: string;
    intro: string;
    reportMeta: ReportMeta;
    disclaimer: string;
  }): string {
    const isZh = /[\u4e00-\u9fff]/.test(input.intro);
    const sectionBlocks = this.buildSectionsFromReportMeta(input.reportMeta, isZh).map((section) => {
      const narrative = section.points.map((point) => `- ${point}`).join('\n');
      return `## ${section.heading}\n${narrative}`;
    });

    return [`# ${input.title}`, '', input.intro, '', ...sectionBlocks.flatMap((block) => ['', block]), '', input.disclaimer]
      .join('\n')
      .trim();
  }

  private buildSectionsFromReportMeta(
    reportMeta: ReportMeta,
    isZh: boolean,
  ): Array<{ heading: string; points: string[] }> {
    const sections: Array<{ heading: string; points: string[] }> = [
      {
        heading: isZh ? '整体结论' : 'Overall Conclusion',
        points: [reportMeta.keyTakeaway, ...reportMeta.whyNow.slice(0, 2)].filter(Boolean),
      },
    ];
    if (reportMeta.allocationGuidance) {
      const allocationPoints = [
        reportMeta.allocationGuidance.summary,
        ...reportMeta.allocationGuidance.weights.map(
          (item) =>
            isZh
              ? `${item.symbol}${item.weightPct !== null ? ` 建议权重 ${item.weightPct}%` : ''}：${item.rationale}`
              : `${item.symbol}${item.weightPct !== null ? ` suggested weight ${item.weightPct}%` : ''}: ${item.rationale}`,
        ),
      ];
      sections.push({
        heading: isZh ? '配置建议' : 'Allocation Guidance',
        points: allocationPoints,
      });
    }
    if (reportMeta.scenarioMap.length > 0) {
      sections.push({
        heading: isZh ? '场景推演' : 'Scenario Map',
        points: reportMeta.scenarioMap.map((item) =>
          isZh
            ? `${this.toZhScenario(item.scenario)}：${item.summary} 触发条件：${item.trigger}`
            : `${this.toEnScenario(item.scenario)}: ${item.summary} Trigger: ${item.trigger}`,
        ),
      });
    }
    if (reportMeta.invalidationSignals.length > 0 || reportMeta.dataQualityNotes.length > 0) {
      sections.push({
        heading: isZh ? '失效条件与数据质量' : 'Invalidation And Data Quality',
        points: [...reportMeta.dataQualityNotes, ...reportMeta.invalidationSignals],
      });
    }
    return sections;
  }

  private buildAllocationWeights(
    topFocus: string | null,
    symbols: string[],
    weakSymbols: string[],
    insufficientSymbols: string[],
  ): NonNullable<ReportMeta['allocationGuidance']>['weights'] {
    const eligibleSymbols = symbols.filter(
      (symbol) =>
        !weakSymbols.includes(symbol) && !insufficientSymbols.includes(symbol),
    );
    if (eligibleSymbols.length === 0) {
      return symbols.map((symbol) => ({
        symbol,
        weightPct: null,
        rationale: insufficientSymbols.includes(symbol)
          ? '证据不完整，暂不建议给明确配置。'
          : weakSymbols.includes(symbol)
            ? '当前偏弱，更适合作为防守观察对象。'
          : '暂不建议给明确权重，先等待更清晰确认。',
      }));
    }
    const canUseTopFocus = topFocus !== null && eligibleSymbols.includes(topFocus);
    const weights = new Map<string, number>();
    if (canUseTopFocus) {
      const primaryWeight = eligibleSymbols.length === 1 ? 100 : 60;
      weights.set(topFocus, primaryWeight);
      const secondarySymbols = eligibleSymbols.filter((symbol) => symbol !== topFocus);
      const secondaryWeights = this.distributeWeight(
        100 - primaryWeight,
        secondarySymbols.length,
      );
      secondarySymbols.forEach((symbol, index) => {
        weights.set(symbol, secondaryWeights[index] ?? 0);
      });
    } else {
      const balancedWeights = this.distributeWeight(100, eligibleSymbols.length);
      eligibleSymbols.forEach((symbol, index) => {
        weights.set(symbol, balancedWeights[index] ?? 0);
      });
    }
    return symbols.map((symbol) => {
      if (insufficientSymbols.includes(symbol)) {
        return {
          symbol,
          weightPct: null,
          rationale: '证据不完整，暂不建议给明确配置。',
        };
      }
      if (weakSymbols.includes(symbol)) {
        return {
          symbol,
          weightPct: null,
          rationale: '当前偏弱，更适合作为防守观察对象。',
        };
      }
      if (canUseTopFocus && symbol === topFocus) {
        return {
          symbol,
          weightPct: weights.get(symbol) ?? 0,
          rationale: '当前综合可读性和优先级最高，适合作为主跟踪对象。',
        };
      }
      return {
        symbol,
        weightPct: weights.get(symbol) ?? null,
        rationale: canUseTopFocus
          ? '可以保留次级观察仓位，但不宜压过主线标的。'
          : '当前没有明确主线，先按均衡观察处理。',
      };
    });
  }

  private buildComparisonWeights(
    comparison: ComparisonSummary,
    runnerUp: ComparisonRankItem | null,
  ): NonNullable<ReportMeta['allocationGuidance']>['weights'] {
    if (!comparison.winner) {
      return comparison.ranked.map((item) => ({
        symbol: item.symbol,
        weightPct: null,
        rationale: '当前不宜基于这次对比强行给出明确配置比例。',
      }));
    }
    return comparison.ranked.map((item) => {
      if (item.symbol === comparison.winner?.symbol) {
        return {
          symbol: item.symbol,
          weightPct: runnerUp ? 65 : 100,
          rationale: '当前综合信号更完整，适合作为主配置方向。',
        };
      }
      if (item.verdict === 'INSUFFICIENT_DATA') {
        return {
          symbol: item.symbol,
          weightPct: null,
          rationale: '证据不足，不建议给明确权重。',
        };
      }
      return {
        symbol: item.symbol,
        weightPct: runnerUp ? 35 : 0,
        rationale: '可保留次级配置，但当前不宜与主线等权处理。',
      };
    });
  }

  private buildComparisonScenarioMap(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
    scenarioPoints: string[],
    isZh: boolean,
  ): ReportMeta['scenarioMap'] {
    const top = comparison.winner?.symbol ?? comparison.ranked[0]?.symbol ?? targets[0]?.identity.symbol ?? '';
    const second = comparison.ranked[1]?.symbol ?? null;
    return [
      {
        scenario: 'bull',
        summary: scenarioPoints[0] ?? (isZh ? `${top} 继续保持相对强势。` : `${top} keeps its relative edge.`),
        trigger: scenarioPoints[1] ?? (isZh ? `${top} 的领先优势继续扩大。` : `${top} extends its lead.`),
      },
      {
        scenario: 'base',
        summary: scenarioPoints[2] ?? (isZh ? `${top}${second ? ` 仍略强于 ${second}` : ' 维持当前优先级'}。` : `${top}${second ? ` remains slightly ahead of ${second}` : ' keeps current priority'}.`),
        trigger: scenarioPoints[3] ?? (isZh ? '市场继续震荡，优先级不发生根本变化。' : 'Market remains choppy and the current order stays intact.'),
      },
      {
        scenario: 'bear',
        summary: scenarioPoints[4] ?? (isZh ? '若风险告警上升，本次配置结论需要撤回。' : 'If risk alerts rise, the current allocation view should be withdrawn.'),
        trigger: scenarioPoints[5] ?? (isZh ? '关键支撑失守或数据退化扩大。' : 'Key support breaks or degraded inputs expand.'),
      },
    ];
  }

  private buildZhBundleScenarioPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    return [
      topFocus
        ? `${topFocus} 若继续保持相对强势，应继续作为主要跟踪对象。`
        : '若没有新的领先者出现，整体更适合维持观察。',
      topFocus
        ? `${topFocus} 的关键支撑不破，才能维持当前优先级。`
        : '需要新的确认信号来建立优先级。',
      weakTargets.length > 0
        ? `${weakTargets.join('、')} 若继续承压，应继续按防守仓位处理。`
        : '其余标的暂时以次级观察为主。',
      insufficientTargets.length > 0
        ? `${insufficientTargets.join('、')} 若补齐证据，才适合重新进入主要讨论。`
        : '若证据结构不变，当前排序大概率维持。',
    ];
  }

  private buildEnBundleScenarioPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    return [
      topFocus
        ? `${topFocus} should remain the primary focus if relative strength persists.`
        : 'If no new leader appears, observation remains more appropriate.',
      topFocus
        ? `${topFocus} needs to hold key support to preserve current priority.`
        : 'A new confirmation signal is needed to establish priority.',
      weakTargets.length > 0
        ? `${weakTargets.join(', ')} should remain in defensive handling if pressure persists.`
        : 'The remaining names should stay secondary for now.',
      insufficientTargets.length > 0
        ? `${insufficientTargets.join(', ')} need fuller evidence before returning to the main discussion.`
        : 'If the evidence profile stays unchanged, the current ordering likely remains intact.',
    ];
  }

  private buildZhBundleInvalidationPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`${topFocus} 若失去当前领先优势，篮子内优先级需要重排。`);
    }
    if (weakTargets.length > 0) {
      points.push(`${weakTargets.join('、')} 若风险继续扩张，不应再保留激进预期。`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`${insufficientTargets.join('、')} 在补齐关键证据前，不应被提升为核心配置。`);
    }
    return points;
  }

  private buildEnBundleInvalidationPoints(
    topFocus: string | null,
    weakTargets: string[],
    insufficientTargets: string[],
  ): string[] {
    const points: string[] = [];
    if (topFocus) {
      points.push(`If ${topFocus} loses its current edge, basket priority should be reordered.`);
    }
    if (weakTargets.length > 0) {
      points.push(`If risk expands further on ${weakTargets.join(', ')}, aggressive expectations should be removed.`);
    }
    if (insufficientTargets.length > 0) {
      points.push(`${insufficientTargets.join(', ')} should not be promoted to core allocation before key evidence recovers.`);
    }
    return points;
  }

  private buildZhComparisonAllocation(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    return this.buildZhComparisonAction(comparison, topRanked).concat(
      comparison.winner
        ? [
            runnerUp
              ? `若一定要给出主次配置，可先按 ${comparison.winner.symbol} 65%、${runnerUp.symbol} 35% 的思路理解，但前提是你接受当前仍有数据退化。`
              : `若一定要给出明确配置，可优先集中在 ${comparison.winner.symbol}。`,
          ]
        : ['当前不建议给出明确比例，先等胜负关系更清晰。'],
    );
  }

  private buildEnComparisonAllocation(
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    return this.buildEnComparisonAction(comparison, topRanked).concat(
      comparison.winner
        ? [
            runnerUp
              ? `If a split must be used, start by reading it as ${comparison.winner.symbol} 65% and ${runnerUp.symbol} 35%, with the clear caveat that degraded inputs still exist.`
              : `If an explicit allocation is required, concentrate first on ${comparison.winner.symbol}.`,
          ]
        : ['Do not force a percentage split until the winner becomes clearer.'],
    );
  }

  private buildZhComparisonScenarios(
    _targets: TargetPipeline[],
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    const lead = comparison.winner?.symbol ?? topRanked?.symbol ?? '领先标的';
    const second = runnerUp?.symbol ?? '次优标的';
    return [
      `${lead} 继续扩大相对优势，本次优先级判断有效。`,
      `${lead} 继续站稳关键位置，且风险告警没有继续恶化。`,
      `${lead} 仍略强于 ${second}，但差距有限，适合主次配置而非极端押注。`,
      '市场继续震荡，主要结论不变，但不适合激进加大仓位。',
      `若 ${lead} 的优势消失或数据继续退化，本次结论应撤回。`,
      '关键支撑失守、黄色告警升级、或新的缺失证据出现。',
    ];
  }

  private buildEnComparisonScenarios(
    _targets: TargetPipeline[],
    comparison: ComparisonSummary,
    topRanked: ComparisonRankItem | null,
    runnerUp: ComparisonRankItem | null,
  ): string[] {
    const lead = comparison.winner?.symbol ?? topRanked?.symbol ?? 'leader';
    const second = runnerUp?.symbol ?? 'runner-up';
    return [
      `${lead} extends its relative edge and the current priority call holds.`,
      `${lead} keeps holding key levels without a further rise in risk alerts.`,
      `${lead} remains slightly ahead of ${second}, so a primary-secondary split still makes sense.`,
      'Market stays choppy, the relative order survives, but aggressive sizing is still premature.',
      `If ${lead} loses its edge or data degrades further, the current call should be withdrawn.`,
      'Key support fails, yellow alerts worsen, or new evidence gaps appear.',
    ];
  }

  private distributeWeight(total: number, count: number): number[] {
    if (count <= 0) {
      return [];
    }
    const base = Math.floor(total / count);
    const remainder = total % count;
    return Array.from({ length: count }, (_, index) =>
      base + (index < remainder ? 1 : 0),
    );
  }

  private toZhScenario(scenario: 'bull' | 'base' | 'bear'): string {
    const mapping = {
      bull: '偏强场景',
      base: '基准场景',
      bear: '偏弱场景',
    } as const;
    return mapping[scenario];
  }

  private toEnScenario(scenario: 'bull' | 'base' | 'bear'): string {
    const mapping = {
      bull: 'Bull Case',
      base: 'Base Case',
      bear: 'Bear Case',
    } as const;
    return mapping[scenario];
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

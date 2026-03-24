import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AlertsSnapshot,
  StrategySnapshot,
} from '../../../data/contracts/analyze-contracts';
import type {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
  WorkflowNodeExecutionMeta,
} from '../../../data/contracts/workflow-contracts';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { buildAnalysisPrompts } from '../prompts';
import type { AnalysisPromptContext } from '../prompts';
import { StrategyService } from '../../strategy/strategy.service';

const stringListField = (
  minItems = 0,
  fallbackItem?: string,
) =>
  z.preprocess(
    (value) => normalizeStringListInput(value, fallbackItem),
    minItems > 0 ? z.array(z.string().min(1)).min(minItems) : z.array(z.string().min(1)),
  );

const analysisDecisionSchema = z.object({
  verdict: z.enum(['BUY', 'SELL', 'HOLD', 'CAUTION', 'INSUFFICIENT_DATA']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(10),
  buyZone: z.string().nullable(),
  sellZone: z.string().nullable(),
  evidence: stringListField(1, 'Evidence unavailable'),
  summary: z.string().min(1),
  keyObservations: stringListField(1, 'Key observations unavailable'),
  riskHighlights: stringListField().default([]),
  opportunityHighlights: stringListField().default([]),
  dataQualityNotes: stringListField().default([]),
});

type AnalysisDecision = z.infer<typeof analysisDecisionSchema>;

type AnalyzeInput = {
  intent: IntentOutput;
  plan: PlanOutput;
  execution: ExecutionOutput;
  alerts: AlertsSnapshot;
};

type AnalysisMode = 'standard' | 'degraded';

@Injectable()
export class AnalysisNodeService {
  constructor(
    private readonly llmRuntime: LlmRuntimeService,
    private readonly strategyService: StrategyService,
  ) {}

  async analyze(input: AnalyzeInput): Promise<AnalysisOutput> {
    const result = await this.analyzeWithMeta(input);
    return result.analysis;
  }

  async analyzeWithMeta(input: AnalyzeInput): Promise<{
    analysis: AnalysisOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    const strategyInput = this.buildStrategyInput(input);
    const gate = this.strategyService.checkRiskGate(strategyInput);
    const hardGate = gate?.type === 'hard_block' ? gate.snapshot : null;
    const degradedGate = gate?.type === 'data_degraded' ? gate.snapshot : null;
    const analysisMode: AnalysisMode = degradedGate ? 'degraded' : 'standard';
    const fallbackStrategy =
      hardGate ?? degradedGate ?? this.buildHeuristicFallbackStrategy(input);
    const fallback = this.buildDeterministicAnalysis(input, fallbackStrategy);

    if (hardGate) {
      return {
        analysis: fallback,
        meta: {
          llmStatus: 'skipped',
          attempts: 0,
          schemaCorrection: false,
          failureReason: hardGate.reason,
          model: null,
        },
      };
    }

    const prompts = buildAnalysisPrompts(
      this.buildPromptContext(input, analysisMode, degradedGate?.reason ?? null),
    );
    const result = await this.llmRuntime.generateStructuredWithMeta({
      nodeName: 'analysis',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: analysisDecisionSchema,
      fallback: () => this.toDecisionFallback(fallback),
    });

    return {
      analysis: this.finalizeAnalysis(
        input,
        this.applyDecisionPolicy(result.data, fallback, analysisMode),
        analysisMode,
      ),
      meta: result.meta,
    };
  }

  toStrategySnapshot(analysis: AnalysisOutput): StrategySnapshot {
    return {
      verdict: analysis.verdict,
      confidence: analysis.confidence,
      reason: analysis.reason,
      buyZone: analysis.buyZone,
      sellZone: analysis.sellZone,
      hardBlocks: analysis.hardBlocks,
      evidence: analysis.evidence,
      asOf: new Date().toISOString(),
      tradingStrategy: analysis.tradingStrategy,
    };
  }

  private finalizeAnalysis(
    input: AnalyzeInput,
    decision: AnalysisDecision,
    analysisMode: AnalysisMode,
  ): AnalysisOutput {
    const strategy = this.strategyService.normalizeDecision({
      price: input.execution.data.market.price,
      technical: input.execution.data.technical,
      liquidity: input.execution.data.liquidity,
      alerts: input.alerts,
      hardBlocks: [],
      decision: {
        verdict: decision.verdict,
        confidence: decision.confidence,
        reason: decision.reason,
        buyZone: decision.buyZone,
        sellZone: decision.sellZone,
        evidence: decision.evidence,
      },
    });

    return {
      verdict: strategy.verdict,
      confidence: strategy.confidence,
      reason: strategy.reason,
      buyZone: analysisMode === 'degraded' ? null : strategy.buyZone,
      sellZone: analysisMode === 'degraded' ? null : strategy.sellZone,
      evidence: strategy.evidence,
      summary: decision.summary.trim(),
      keyObservations: this.normalizeItems(decision.keyObservations, 8),
      hardBlocks: strategy.hardBlocks,
      riskHighlights: this.normalizeItems(decision.riskHighlights, 6),
      opportunityHighlights: this.normalizeItems(
        decision.opportunityHighlights,
        6,
      ),
      dataQualityNotes: this.normalizeItems(decision.dataQualityNotes, 6),
      tradingStrategy:
        analysisMode === 'degraded' ? undefined : strategy.tradingStrategy,
    };
  }

  private buildPromptContext(
    input: AnalyzeInput,
    analysisMode: AnalysisMode,
    degradedReason: string | null,
  ): AnalysisPromptContext {
    const price = input.execution.data.market.price;
    const onchain = input.execution.data.onchain.cexNetflow;
    const technical = input.execution.data.technical;
    const security = input.execution.data.security;
    const liquidity = input.execution.data.liquidity;
    const tokenomics = input.execution.data.tokenomics;
    const fundamentals = input.execution.data.fundamentals;
    const sentiment = input.execution.data.sentiment;
    const news = input.execution.data.news.items.slice(0, 5).map((item) => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      category: item.category,
      relevanceScore: item.relevanceScore,
    }));

    return {
      analysisMode,
      degradedReason,
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
          marketCapRank: price.marketCapRank,
          circulatingSupply: price.circulatingSupply,
          totalSupply: price.totalSupply,
          maxSupply: price.maxSupply,
          fdvUsd: price.fdvUsd,
          totalVolume24hUsd: price.totalVolume24hUsd,
          athUsd: price.athUsd,
          atlUsd: price.atlUsd,
          athChangePct: price.athChangePct,
          atlChangePct: price.atlChangePct,
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
          inflowUsd: onchain.inflowUsd,
          outflowUsd: onchain.outflowUsd,
          exchanges: onchain.exchanges,
          degraded: onchain.degraded,
        },
        security: {
          riskLevel: security.riskLevel,
          isHoneypot: security.isHoneypot,
          canTradeSafely: security.canTradeSafely,
          holderCount: security.holderCount,
          isInCex: security.isInCex,
          degraded: security.degraded,
        },
        liquidity: {
          liquidityUsd: liquidity.liquidityUsd,
          volume24hUsd: liquidity.volume24hUsd,
          withdrawalRiskFlag: liquidity.withdrawalRiskFlag,
          rugpullRiskSignal: liquidity.rugpullRiskSignal,
          quoteToken: liquidity.quoteToken,
          hasUsdtOrUsdcPair: liquidity.hasUsdtOrUsdcPair,
          priceImpact1kPct: liquidity.priceImpact1kPct,
          degraded: liquidity.degraded,
        },
        tokenomics: {
          teamPct: tokenomics.allocation.teamPct,
          investorPct: tokenomics.allocation.investorPct,
          communityPct: tokenomics.allocation.communityPct,
          foundationPct: tokenomics.allocation.foundationPct,
          inflationRate: tokenomics.inflationRate.currentAnnualPct,
          vestingCount: tokenomics.vestingSchedule.length,
          tokenomicsEvidenceInsufficient:
            tokenomics.tokenomicsEvidenceInsufficient,
          degraded: tokenomics.degraded,
        },
        fundamentals: {
          profile: {
            name: fundamentals.profile.name,
            oneLiner: fundamentals.profile.oneLiner,
            establishmentDate: fundamentals.profile.establishmentDate,
            active: fundamentals.profile.active,
            tags: fundamentals.profile.tags,
            rtScore: fundamentals.profile.rtScore,
            tvlScore: fundamentals.profile.tvlScore,
            similarProjects: fundamentals.profile.similarProjects,
          },
          teamCount: fundamentals.team.length,
          investorCount: fundamentals.investors.length,
          fundraisingCount: fundamentals.fundraising.length,
          lastFundraisingRound: fundamentals.fundraising[0]?.round ?? null,
          lastFundraisingAmount: fundamentals.fundraising[0]?.amountUsd ?? null,
          ecosystems: fundamentals.ecosystems.ecosystems,
          social: {
            heatRank: fundamentals.social.heatRank,
            influenceRank: fundamentals.social.influenceRank,
            followers: fundamentals.social.followers,
          },
          degraded: fundamentals.degraded,
        },
        sentiment: {
          signal: sentiment.signal,
          sentimentScore: sentiment.sentimentScore,
          socialVolume: sentiment.socialVolume,
          socialDominance: sentiment.socialDominance,
          devActivity: sentiment.devActivity,
          githubActivity: sentiment.githubActivity,
          degraded: sentiment.degraded,
        },
        news,
      },
      alerts: {
        level: input.alerts.alertLevel,
        redCount: input.alerts.redCount,
        yellowCount: input.alerts.yellowCount,
        riskState: input.alerts.riskState,
        items: input.alerts.items,
      },
      dataQuality: {
        degradedNodes: input.execution.degradedNodes,
        missingEvidence: input.execution.missingEvidence,
      },
      outputPolicy: {
        noHallucination: true,
        mentionSourceLimits: true,
        respectHardRiskControls: true,
        comparisonMode:
          input.intent.taskType === 'comparison'
            ? 'analyze current target only; final winner decided by orchestrator summary'
            : 'single target analysis',
      },
    };
  }

  private applyDecisionPolicy(
    decision: AnalysisDecision,
    fallback: AnalysisOutput,
    analysisMode: AnalysisMode,
  ): AnalysisDecision {
    if (analysisMode === 'standard') {
      return decision;
    }

    const allowedVerdicts = new Set<AnalysisDecision['verdict']>([
      'HOLD',
      'CAUTION',
      'INSUFFICIENT_DATA',
    ]);

    if (!allowedVerdicts.has(decision.verdict)) {
      return this.toDecisionFallback(fallback);
    }

    return {
      ...decision,
      confidence: Number(Math.min(decision.confidence, 0.55).toFixed(2)),
      buyZone: null,
      sellZone: null,
      evidence: this.normalizeItems(
        [...decision.evidence, ...fallback.evidence],
        6,
      ),
      dataQualityNotes: this.normalizeItems(
        [...decision.dataQualityNotes, ...fallback.dataQualityNotes],
        6,
      ),
    };
  }

  private buildDeterministicAnalysis(
    input: AnalyzeInput,
    strategy: StrategySnapshot,
  ): AnalysisOutput {
    const { execution, alerts } = input;
    const price = execution.data.market.price;
    const technical = execution.data.technical;
    const onchain = execution.data.onchain.cexNetflow;
    const liquidity = execution.data.liquidity;
    const security = execution.data.security;
    const tokenomics = execution.data.tokenomics;
    const sentiment = execution.data.sentiment;
    const fundamentals = execution.data.fundamentals;

    const keyObservations: string[] = [];

    if (typeof price.priceUsd === 'number') {
      keyObservations.push(`Current price: $${price.priceUsd.toFixed(6)}`);
    }
    if (typeof price.change24hPct === 'number') {
      keyObservations.push(
        `24h change: ${price.change24hPct >= 0 ? '+' : ''}${price.change24hPct.toFixed(2)}%`,
      );
    }
    if (price.marketCapRank) {
      keyObservations.push(`Market cap rank: #${price.marketCapRank}`);
    }
    keyObservations.push(`Technical: ${technical.summarySignal}`);
    if (technical.rsi.value !== null) {
      keyObservations.push(
        `RSI(${technical.rsi.period}): ${technical.rsi.value.toFixed(1)}`,
      );
    }
    keyObservations.push(`CEX Flow: ${onchain.signal.replace('_', ' ')}`);
    if (onchain.netflowUsd !== null) {
      keyObservations.push(`Netflow: $${this.fmt(onchain.netflowUsd)}`);
    }
    keyObservations.push(
      `Security: ${security.riskLevel} risk, ${security.canTradeSafely === false ? 'NOT ' : ''}safe to trade`,
    );
    keyObservations.push(
      `Liquidity: $${this.fmt(liquidity.liquidityUsd)}, Rugpull: ${liquidity.rugpullRiskSignal}`,
    );
    if (tokenomics.inflationRate.currentAnnualPct !== null) {
      keyObservations.push(
        `Inflation: ${tokenomics.inflationRate.currentAnnualPct.toFixed(1)}%/year`,
      );
    }
    keyObservations.push(`${tokenomics.vestingSchedule.length} vesting events`);
    keyObservations.push(`Sentiment: ${sentiment.signal}`);
    if (sentiment.devActivity !== null) {
      keyObservations.push(`Dev Activity: ${sentiment.devActivity.toFixed(1)}`);
    }
    if (fundamentals.profile.name) {
      keyObservations.push(`Project: ${fundamentals.profile.name}`);
    }
    if (fundamentals.profile.rtScore !== null) {
      keyObservations.push(`RT Score: ${fundamentals.profile.rtScore}`);
    }
    if (fundamentals.ecosystems.ecosystems.length > 0) {
      keyObservations.push(
        `Ecosystems: ${fundamentals.ecosystems.ecosystems.join(', ')}`,
      );
    }

    const riskHighlights: string[] = [];
    for (const alert of alerts.items) {
      if (alert.severity === 'critical') {
        riskHighlights.push(`[CRITICAL] ${alert.code}: ${alert.message}`);
      } else if (alert.severity === 'warning') {
        riskHighlights.push(`[WARNING] ${alert.code}: ${alert.message}`);
      }
    }
    if (strategy.hardBlocks.length > 0) {
      riskHighlights.push(`Hard blocks: ${strategy.hardBlocks.join(', ')}`);
    }

    const opportunityHighlights: string[] = [];
    if (strategy.verdict === 'BUY') {
      opportunityHighlights.push(strategy.reason);
      if (strategy.buyZone) {
        opportunityHighlights.push(`Entry strategy: ${strategy.buyZone}`);
      }
    } else if (strategy.verdict === 'HOLD') {
      opportunityHighlights.push('Signals are mixed; awaiting confirmation');
    } else if (strategy.verdict === 'CAUTION') {
      opportunityHighlights.push('Warning signs present; reduce exposure');
    } else if (strategy.verdict === 'SELL') {
      opportunityHighlights.push(strategy.reason);
      if (strategy.sellZone) {
        opportunityHighlights.push(`Exit strategy: ${strategy.sellZone}`);
      }
    }

    const dataQualityNotes: string[] = [];
    if (execution.degradedNodes.length > 0) {
      dataQualityNotes.push(
        `⚠️ Degraded nodes: ${execution.degradedNodes.join(', ')}`,
      );
    }
    if (execution.missingEvidence.length > 0) {
      dataQualityNotes.push(
        `⚠️ Missing evidence: ${execution.missingEvidence.join(', ')}`,
      );
    }
    if (dataQualityNotes.length === 0) {
      dataQualityNotes.push('✅ All core nodes returned non-degraded snapshots');
    }

    const summary =
      input.intent.language === 'zh'
        ? `策略结论: ${strategy.verdict} (置信度 ${(strategy.confidence * 100).toFixed(0)}%)\n${strategy.reason}`
        : `Strategy: ${strategy.verdict} (confidence ${(strategy.confidence * 100).toFixed(0)}%)\n${strategy.reason}`;

    return {
      verdict: strategy.verdict,
      confidence: strategy.confidence,
      reason: strategy.reason,
      buyZone: strategy.buyZone,
      sellZone: strategy.sellZone,
      evidence: strategy.evidence,
      summary,
      keyObservations: this.normalizeItems(keyObservations, 8),
      hardBlocks: strategy.hardBlocks,
      riskHighlights: this.normalizeItems(riskHighlights, 6),
      opportunityHighlights: this.normalizeItems(opportunityHighlights, 6),
      dataQualityNotes: this.normalizeItems(dataQualityNotes, 6),
      tradingStrategy: strategy.tradingStrategy,
    };
  }

  private toDecisionFallback(fallback: AnalysisOutput): AnalysisDecision {
    return {
      verdict: fallback.verdict,
      confidence: fallback.confidence,
      reason: fallback.reason,
      buyZone: fallback.buyZone,
      sellZone: fallback.sellZone,
      evidence: fallback.evidence,
      summary: fallback.summary,
      keyObservations: fallback.keyObservations,
      riskHighlights: fallback.riskHighlights,
      opportunityHighlights: fallback.opportunityHighlights,
      dataQualityNotes: fallback.dataQualityNotes,
    };
  }

  private buildStrategyInput(input: AnalyzeInput) {
    return {
      price: input.execution.data.market.price,
      technical: input.execution.data.technical,
      onchain: input.execution.data.onchain.cexNetflow,
      security: input.execution.data.security,
      liquidity: input.execution.data.liquidity,
      tokenomics: input.execution.data.tokenomics,
      sentiment: {
        signal: input.execution.data.sentiment.signal,
        score: input.execution.data.sentiment.sentimentScore,
      },
      alerts: input.alerts,
    };
  }

  private buildHeuristicFallbackStrategy(input: AnalyzeInput): StrategySnapshot {
    const price = input.execution.data.market.price;
    const technical = input.execution.data.technical;
    const onchain = input.execution.data.onchain.cexNetflow;
    const liquidity = input.execution.data.liquidity;
    const security = input.execution.data.security;
    const tokenomics = input.execution.data.tokenomics;
    const sentiment = input.execution.data.sentiment;

    let bullScore = 0;
    let bearScore = 0;
    const evidence: string[] = [];

    if (technical.summarySignal === 'bullish') {
      bullScore += 1.5;
      evidence.push('Technical posture is bullish');
    } else if (technical.summarySignal === 'bearish') {
      bearScore += 1.5;
      evidence.push('Technical posture is bearish');
    } else if (technical.summarySignal === 'mixed') {
      bearScore += 0.25;
      evidence.push('Technical posture is mixed');
    }

    if (technical.rsi.value !== null) {
      if (technical.rsi.value < 35) {
        bullScore += 0.5;
        evidence.push(`RSI(${technical.rsi.period}) is near oversold at ${technical.rsi.value.toFixed(1)}`);
      } else if (technical.rsi.value > 70) {
        bearScore += 0.5;
        evidence.push(`RSI(${technical.rsi.period}) is near overbought at ${technical.rsi.value.toFixed(1)}`);
      }
    }

    if (onchain.signal === 'buy_pressure') {
      bullScore += 1.25;
      evidence.push('Exchange flow suggests accumulation');
    } else if (onchain.signal === 'sell_pressure') {
      bearScore += 1.25;
      evidence.push('Exchange flow suggests sell pressure');
    }

    if (sentiment.signal === 'bullish') {
      bullScore += 0.75;
      evidence.push('Sentiment is bullish');
    } else if (sentiment.signal === 'bearish') {
      bearScore += 0.75;
      evidence.push('Sentiment is bearish');
    }
    if (typeof sentiment.sentimentScore === 'number') {
      if (sentiment.sentimentScore >= 15) {
        bullScore += 0.25;
      } else if (sentiment.sentimentScore <= -15) {
        bearScore += 0.25;
      }
    }

    if (typeof price.change24hPct === 'number') {
      if (price.change24hPct >= 4) {
        bullScore += 0.75;
        evidence.push(`24h price momentum is strong at +${price.change24hPct.toFixed(2)}%`);
      } else if (price.change24hPct >= 1) {
        bullScore += 0.25;
      } else if (price.change24hPct <= -4) {
        bearScore += 0.75;
        evidence.push(`24h price momentum is weak at ${price.change24hPct.toFixed(2)}%`);
      } else if (price.change24hPct <= -1) {
        bearScore += 0.25;
      }
    }

    if (input.alerts.yellowCount >= 2) {
      bearScore += 0.75;
      evidence.push(`${input.alerts.yellowCount} warning alerts are active`);
    } else if (input.alerts.yellowCount === 1) {
      bearScore += 0.25;
      evidence.push('One warning alert is active');
    }

    if (liquidity.withdrawalRiskFlag) {
      bearScore += 1;
      evidence.push('Liquidity withdrawal risk is flagged');
    }
    if (liquidity.rugpullRiskSignal === 'high') {
      bearScore += 1;
      evidence.push('Liquidity risk is elevated');
    } else if (liquidity.rugpullRiskSignal === 'medium') {
      bearScore += 0.5;
      evidence.push('Liquidity quality is only medium');
    }

    if (security.riskLevel === 'medium') {
      bearScore += 0.75;
      evidence.push('Security risk level is medium');
    }

    if (typeof tokenomics.inflationRate.currentAnnualPct === 'number') {
      if (tokenomics.inflationRate.currentAnnualPct >= 20) {
        bearScore += 0.5;
        evidence.push(
          `Token inflation is high at ${tokenomics.inflationRate.currentAnnualPct.toFixed(1)}% annually`,
        );
      } else if (tokenomics.inflationRate.currentAnnualPct <= 5) {
        bullScore += 0.25;
      }
    }

    const delta = bullScore - bearScore;
    let verdict: StrategySnapshot['verdict'];
    let confidence: number;
    let reason: string;
    let buyZone: string | null = null;
    let sellZone: string | null = null;

    if (delta >= 2) {
      verdict = 'BUY';
      confidence = Math.min(0.7 + delta * 0.04, 0.86);
      buyZone =
        technical.ma.ma25 !== null
          ? 'Accumulate near MA25 or on shallow pullbacks'
          : 'Scale in on pullbacks';
      reason =
        'Bullish technical, flow, and sentiment signals are aligned with manageable risk.';
    } else if (delta <= -2) {
      verdict = 'SELL';
      confidence = Math.min(0.7 + Math.abs(delta) * 0.04, 0.86);
      sellZone =
        technical.swingHigh !== null
          ? 'Reduce exposure into resistance and failed bounces'
          : 'Reduce exposure on strength';
      reason =
        'Bearish momentum and risk signals outweigh the available upside evidence.';
    } else if (bearScore >= 1.5 && delta < 0) {
      verdict = 'CAUTION';
      confidence = Math.min(0.58 + bearScore * 0.04, 0.74);
      sellZone = 'Tighten risk and avoid aggressive entries';
      reason =
        'Risk signals are elevated enough to justify caution, but not a forced exit.';
    } else {
      verdict = 'HOLD';
      confidence = Math.min(0.54 + Math.abs(delta) * 0.03, 0.68);
      reason =
        delta > 0
          ? 'Constructive signals exist, but not enough to support an aggressive entry.'
          : delta < 0
            ? 'Some pressure is visible, but the setup is not weak enough for a clear sell call.'
            : 'Signals are balanced, so waiting for clearer confirmation is more appropriate.';
    }

    if (evidence.length === 0) {
      evidence.push('Core signals are mixed, so the fallback remains conservative');
    }

    return this.strategyService.normalizeDecision({
      price,
      technical,
      liquidity,
      alerts: input.alerts,
      hardBlocks: [],
      decision: {
        verdict,
        confidence: Number(confidence.toFixed(2)),
        reason,
        buyZone,
        sellZone,
        evidence: this.normalizeItems(evidence, 6),
      },
    });
  }

  private normalizeItems(items: string[], limit: number): string[] {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
      0,
      limit,
    );
  }

  private fmt(value: number | null): string {
    if (value === null) return 'N/A';
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return value.toFixed(2);
  }
}

function normalizeStringListInput(
  value: unknown,
  fallbackItem?: string,
): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === 'string' ? [item] : item == null ? [] : [String(item)],
      )
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const normalized = value
      .split(/\r?\n|(?<=\.)\s+(?=[A-Z\u4e00-\u9fff\-\d])/)
      .map((item) => item.replace(/^[-*\d\.\)\s]+/, '').trim())
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (value == null) {
    return fallbackItem ? [fallbackItem] : [];
  }

  const text = String(value).trim();
  if (text.length > 0) {
    return [text];
  }

  return fallbackItem ? [fallbackItem] : [];
}

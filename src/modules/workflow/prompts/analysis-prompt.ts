import type {
  IntentOutput,
  PlanOutput,
  ExecutionOutput,
} from '../../../data/contracts/workflow-contracts';
import type {
  AlertsSnapshot,
  StrategySnapshot,
} from '../../../data/contracts/analyze-contracts';
import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type AnalysisPromptContext = {
  intent: {
    query: IntentOutput['userQuery'];
    language: IntentOutput['language'];
    taskType: IntentOutput['taskType'];
    objective: IntentOutput['objective'];
    sentimentBias: IntentOutput['sentimentBias'];
    entities: IntentOutput['entities'];
    focusAreas: IntentOutput['focusAreas'];
  };
  analysisQuestions: PlanOutput['analysisQuestions'];
  evidence: {
    price: {
      priceUsd: number | null;
      change1hPct: number | null;
      change24hPct: number | null;
      change7dPct: number | null;
      change30dPct: number | null;
      degraded: boolean;
    };
    technical: {
      summarySignal: string;
      rsi: number | null;
      macdSignal: string;
      degraded: boolean;
    };
    onchain: {
      signal: string;
      netflowUsd: number | null;
      degraded: boolean;
    };
    security: {
      riskLevel: string;
      isHoneypot: boolean | null;
      canTradeSafely: boolean | null;
      degraded: boolean;
    };
    liquidity: {
      liquidityUsd: number | null;
      withdrawalRiskFlag: boolean;
      rugpullRiskSignal: string;
      degraded: boolean;
    };
    tokenomics: {
      tokenomicsEvidenceInsufficient: boolean;
      degraded: boolean;
    };
    news: Array<{
      title: string;
      source: string;
      publishedAt: string;
      category: string | null;
      relevanceScore: number;
    }>;
  };
  alerts: {
    level: AlertsSnapshot['alertLevel'];
    redCount: number;
    yellowCount: number;
    items: AlertsSnapshot['items'];
  };
  strategy: {
    verdict: StrategySnapshot['verdict'];
    confidence: number;
    reason: string;
    evidence: string[];
  };
  dataQuality: {
    degradedNodes: ExecutionOutput['degradedNodes'];
    missingEvidence: ExecutionOutput['missingEvidence'];
  };
  outputPolicy: {
    noHallucination: boolean;
    mentionSourceLimits: boolean;
    doNotOverrideStrategyVerdict: boolean;
    comparisonMode: string;
  };
};

export function buildAnalysisPrompts(
  context: AnalysisPromptContext,
): PromptBundle {
  const requiredKeys = [
    'summary',
    'keyObservations',
    'riskHighlights',
    'opportunityHighlights',
    'dataQualityNotes',
  ];
  const isComparison = context.intent.taskType === 'comparison';
  const modeRules = isComparison
    ? [
        'Comparison mode is active; this output is per-target evidence only.',
        'Never declare final winner across targets in this node.',
        'Include explicit relative strengths/weaknesses that help downstream cross-target ranking.',
      ]
    : ['Single-asset mode is active.'];

  return {
    systemPrompt: [
      'You are an analysis node for crypto market intelligence.',
      'Return strict JSON only. No markdown and no additional keys.',
      'Compare bullish/bearish evidence, risk constraints, and data quality.',
      'If evidence quality is weak, state it explicitly in dataQualityNotes.',
      'Do not produce claims that are not grounded in provided evidence.',
      'Do not contradict strategy verdict or critical security constraints.',
      ...modeRules,
    ].join(' '),
    userPrompt: [
      'Generate analysis JSON with fields: summary, keyObservations, riskHighlights, opportunityHighlights, dataQualityNotes.',
      `Required keys: ${requiredKeys.join(', ')}.`,
      'Use this context:',
      stringifyPromptContext(context),
      'If degradedNodes includes security/liquidity/price, emphasize confidence limitations.',
      isComparison
        ? 'In comparison mode, include at least one observation about why this target may outperform or underperform peers under current evidence.'
        : 'Focus on direct investability and risk-adjusted interpretation for this target.',
    ].join('\n'),
  };
}

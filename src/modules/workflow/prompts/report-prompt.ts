import type {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
} from '../../../data/contracts/workflow-contracts';
import type {
  AlertsSnapshot,
  StrategySnapshot,
} from '../../../data/contracts/analyze-contracts';
import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type ReportPromptContext = {
  language: IntentOutput['language'];
  query: IntentOutput['userQuery'];
  taskType: IntentOutput['taskType'];
  objective: IntentOutput['objective'];
  sentimentBias: IntentOutput['sentimentBias'];
  entities: IntentOutput['entities'];
  target: {
    symbol: ExecutionOutput['identity']['symbol'];
    chain: ExecutionOutput['identity']['chain'];
  };
  strategy: {
    verdict: StrategySnapshot['verdict'];
    confidence: StrategySnapshot['confidence'];
    reason: StrategySnapshot['reason'];
    buyZone: StrategySnapshot['buyZone'];
    sellZone: StrategySnapshot['sellZone'];
  };
  alerts: {
    level: AlertsSnapshot['alertLevel'];
    riskState: AlertsSnapshot['riskState'];
    redCount: AlertsSnapshot['redCount'];
    yellowCount: AlertsSnapshot['yellowCount'];
  };
  analysis: AnalysisOutput;
  execution: {
    degradedNodes: ExecutionOutput['degradedNodes'];
    missingEvidence: ExecutionOutput['missingEvidence'];
  };
  outputRules: {
    sectionsAtLeast: number;
    pointsPerSectionAtLeast: number;
    disclaimerRequired: boolean;
    noUnverifiableClaims: boolean;
  };
};

export function buildReportPrompts(context: ReportPromptContext): PromptBundle {
  const requiredKeys = [
    'title',
    'executiveSummary',
    'sections',
    'verdict',
    'confidence',
    'disclaimer',
  ];
  const isComparison = context.taskType === 'comparison';
  const modeRules = isComparison
    ? [
        'Comparison mode is active; this report is only for the current target.',
        'Do not announce global winner or final ranking across all targets.',
      ]
    : ['Single-asset mode is active.'];

  return {
    systemPrompt: [
      'You are a report node for a crypto analysis assistant.',
      'Return strict JSON only. No markdown, no commentary.',
      'Produce a concise but complete final report aligned with strategy and risk constraints.',
      'Use language from context.language.',
      'Do not override strategy verdict.',
      'When taskType is comparison, this report is per-target, not the final global winner summary.',
      ...modeRules,
    ].join(' '),
    userPrompt: [
      'Generate final report JSON with fields: title, executiveSummary, sections, verdict, confidence, disclaimer.',
      `Required keys: ${requiredKeys.join(', ')}.`,
      'Use context:',
      stringifyPromptContext(context),
      'If degradedNodes is non-empty, explicitly mention data limitations in Data Quality section.',
      isComparison
        ? 'For comparison mode, sections should include: this target strengths, this target weaknesses, and data-quality limitations for ranking fairness.'
        : 'For single-asset mode, sections should emphasize actionable signals and risk controls.',
    ].join('\n'),
  };
}

import type { IntentOutput } from '../../../data/contracts/workflow-contracts';
import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type PlanningPromptContext = {
  query: string;
  language: IntentOutput['language'];
  taskType: IntentOutput['taskType'];
  objective: IntentOutput['objective'];
  sentimentBias: IntentOutput['sentimentBias'];
  timeWindow: IntentOutput['timeWindow'];
  entities: string[];
  focusAreas: IntentOutput['focusAreas'];
  constraints: string[];
  target: {
    symbol: AnalyzeIdentity['symbol'];
    chain: AnalyzeIdentity['chain'];
    tokenAddress: AnalyzeIdentity['tokenAddress'];
  };
  allowedDataTypes: string[];
  priorityRule: {
    high: string;
    medium: string;
    low: string;
  };
  hardConstraints: string[];
  sourceCatalog: Record<string, string[]>;
};

export function buildPlanningPrompts(
  context: PlanningPromptContext,
): PromptBundle {
  const requiredKeys = ['requirements', 'analysisQuestions'];
  const isComparison = context.taskType === 'comparison';
  const modeRules = isComparison
    ? [
        'Comparison mode is active.',
        'Planning must be symmetric so multiple targets remain comparable under the same rubric.',
        'Do not add target-specific data types that would break fairness across candidates.',
      ]
    : ['Single-asset mode is active.'];

  return {
    systemPrompt: [
      'You are a planning node for a crypto analysis system.',
      'Return strict JSON only. No markdown, no prose, no code fences.',
      'Select a minimal but sufficient evidence plan for the intent.',
      'Do not invent unsupported data types.',
      'Use only approved sources from sourceCatalog.',
      'Keep security/liquidity/price as required in all plans.',
      ...modeRules,
    ].join(' '),
    userPrompt: [
      'Build plan JSON using this context:',
      `Required keys: ${requiredKeys.join(', ')}.`,
      stringifyPromptContext(context),
      'Output requirements[] and analysisQuestions[] only.',
      'Each requirement.sourceHint must be a subset of sourceCatalog[dataType].',
      isComparison
        ? 'For comparison, analysisQuestions must cover: upside drivers, downside drivers, risk blockers, and data-quality impact for fair cross-target ranking.'
        : 'Questions should prioritize the user objective and execution constraints.',
    ].join('\n'),
  };
}

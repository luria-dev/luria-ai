import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type IntentPromptContext = {
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  taskTypes: readonly string[];
  objectives: readonly string[];
  sentiments: readonly string[];
  focusAreas: readonly string[];
  memo: {
    lastIntent: {
      taskType: string;
      objective: string;
      entities: string[];
      symbols: string[];
      chains: string[];
      focusAreas: string[];
    };
    lastResolvedTargets: unknown[];
  } | null;
  rules: string[];
  examples: Array<{
    query: string;
    expectedTaskType: string;
    expectedEntities: string[];
  }>;
};

export function buildIntentPrompts(context: IntentPromptContext): PromptBundle {
  const requiredKeys = [
    'userQuery',
    'language',
    'taskType',
    'objective',
    'sentimentBias',
    'timeWindow',
    'entities',
    'symbols',
    'chains',
    'focusAreas',
    'constraints',
  ];
  const normalizedQuery = context.query.toLowerCase();
  const hasComparisonCue =
    normalizedQuery.includes('vs') ||
    normalizedQuery.includes('versus') ||
    normalizedQuery.includes('compare') ||
    normalizedQuery.includes('比较') ||
    normalizedQuery.includes('对比') ||
    normalizedQuery.includes('谁更') ||
    normalizedQuery.includes('哪个更');

  return {
    systemPrompt: [
      'You are an intent parser for a crypto analysis system.',
      'Return strict JSON only, no markdown and no extra keys.',
      'Extract taskType, objective, sentiment bias, focus areas, entities, symbols, chains, and constraints.',
      'Do not invent values outside allowed enums.',
      'Comparison requires at least two concrete assets in entities/symbols.',
      'If data is ambiguous, prefer single_asset over forced comparison.',
    ].join(' '),
    userPrompt: [
      'Extract intent JSON with fields exactly matching schema.',
      `Required keys: ${requiredKeys.join(', ')}.`,
      hasComparisonCue
        ? 'Query has comparison cues. Use taskType="comparison" when two or more concrete assets are present.'
        : 'No strong comparison cue detected. Prefer taskType="single_asset" unless evidence clearly indicates comparison.',
      'Use context:',
      stringifyPromptContext(context),
    ].join('\n'),
  };
}

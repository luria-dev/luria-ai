import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type IntentPromptContext = {
  query: string;
  defaultTimeWindow: '24h' | '7d';
  preferredChain: string | null;
  interactionTypes: readonly string[];
  taskTypes: readonly string[];
  outputGoals: readonly string[];
  tokenRegistry: Array<{
    symbol: string;
    aliases: string[];
    chain: string;
  }>;
  memo: {
    lastIntent: {
      interactionType: string;
      taskType: string;
      outputGoal: string;
      timeWindow: string;
      entities: string[];
      needsClarification: boolean;
    };
    lastResolvedTargets: Array<{
      targetKey: string;
      symbol: string;
      chain: string;
    }>;
  } | null;
  rules: string[];
};

export function buildIntentPrompts(context: IntentPromptContext): PromptBundle {
  const requiredKeys = [
    'interactionType',
    'taskType',
    'targets',
    'timeWindow',
    'outputGoal',
    'needsClarification',
  ];

  const examples = [
    {
      input: {
        userMessage: 'What about ETH then?',
        memo: {
          lastIntent: {
            taskType: 'single_asset',
            outputGoal: 'strategy',
            entities: ['BTC'],
          },
          lastResolvedTargets: [{ symbol: 'BTC', chain: 'bitcoin' }],
        },
      },
      output: {
        interactionType: 'follow_up',
        taskType: 'single_asset',
        targets: ['ETH'],
        timeWindow: '24h',
        outputGoal: 'strategy',
        needsClarification: false,
      },
    },
    {
      input: {
        userMessage: 'Analyze BTC, ETH, and SOL, and give advice for each one separately.',
        memo: null,
      },
      output: {
        interactionType: 'new_query',
        taskType: 'multi_asset',
        targets: ['BTC', 'ETH', 'SOL'],
        timeWindow: '24h',
        outputGoal: 'strategy',
        needsClarification: false,
      },
    },
    {
      input: {
        userMessage: 'Compare BTC and ETH and tell me which one looks stronger this week.',
        memo: null,
      },
      output: {
        interactionType: 'new_query',
        taskType: 'comparison',
        targets: ['BTC', 'ETH'],
        timeWindow: '7d',
        outputGoal: 'comparison',
        needsClarification: false,
      },
    },
    {
      input: {
        userMessage: 'Show me the next move.',
        memo: null,
      },
      output: {
        interactionType: 'new_query',
        taskType: 'single_asset',
        targets: [],
        timeWindow: 'unspecified',
        outputGoal: 'analysis',
        needsClarification: true,
      },
    },
  ];

  return {
    systemPrompt: [
      'You are the intent router for a crypto analysis workflow.',
      'Your job is to understand the user message and output the minimum workflow-routing JSON.',
      'You are NOT doing market analysis, planning, or report writing.',
      'Return strict JSON only. No markdown. No prose. No extra keys.',
      'Use only the allowed enum values.',
      'targets must be short asset mentions or symbols only, not explanations.',
      'If the user clearly wants a comparison between 2 or more assets, use taskType="comparison" and outputGoal="comparison".',
      'If the user mentions multiple assets but wants separate analysis, use taskType="multi_asset".',
      'If the request is missing a usable target or is too ambiguous to run safely, set needsClarification=true.',
      'selection_reply should only be used when the message is clearly a candidate selection reply.',
      'If time window is not explicit, you may use "unspecified" instead of guessing.',
    ].join(' '),
    userPrompt: [
      'Return JSON with exactly these keys:',
      requiredKeys.join(', '),
      'Field rules:',
      '- interactionType: new_query | follow_up | selection_reply',
      '- taskType: single_asset | multi_asset | comparison',
      '- targets: up to 5 asset mentions/symbols',
      '- timeWindow: 24h | 7d | unspecified',
      '- outputGoal: analysis | strategy | comparison',
      '- needsClarification: boolean',
      'Decision principles:',
      ...context.rules.map((rule) => `- ${rule}`),
      'Examples:',
      stringifyPromptContext(examples),
      'Available token registry for normalization hints:',
      stringifyPromptContext(context.tokenRegistry),
      'Current context:',
      stringifyPromptContext(context),
    ].join('\n'),
  };
}

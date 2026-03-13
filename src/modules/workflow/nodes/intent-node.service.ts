import { Injectable } from '@nestjs/common';
import {
  IntentMemoSnapshot,
  IntentOutput,
  intentOutputSchema,
  intentFocusAreaSchema,
  intentObjectiveSchema,
  intentTaskTypeSchema,
  intentSentimentSchema,
} from '../../../data/contracts/workflow-contracts';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { buildIntentPrompts } from '../prompts';
import type { IntentPromptContext } from '../prompts';

type ParseIntentInput = {
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  memo?: IntentMemoSnapshot | null;
};

@Injectable()
export class IntentNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async parse(input: ParseIntentInput): Promise<IntentOutput> {
    const fallback = this.buildDeterministicIntent(input);
    const context: IntentPromptContext = {
      query: input.query,
      timeWindow: input.timeWindow,
      preferredChain: input.preferredChain,
      taskTypes: intentTaskTypeSchema.options,
      objectives: intentObjectiveSchema.options,
      sentiments: intentSentimentSchema.options,
      focusAreas: intentFocusAreaSchema.options,
      memo: input.memo
        ? {
            lastIntent: {
              taskType: input.memo.lastIntent.taskType,
              objective: input.memo.lastIntent.objective,
              entities: input.memo.lastIntent.entities,
              symbols: input.memo.lastIntent.symbols,
              chains: input.memo.lastIntent.chains,
              focusAreas: input.memo.lastIntent.focusAreas,
            },
            lastResolvedTargets: input.memo.lastResolvedTargets,
          }
        : null,
      rules: [
        'Only use provided enum values.',
        'taskType is "comparison" only when the user clearly requests comparison across >=2 assets.',
        'When query is a follow-up and no new entity is mentioned, you may reuse entities from memo context.',
        'focusAreas must contain at least one value.',
        'Keep constraints concise and actionable.',
        'entities and symbols should be uppercase and deduplicated when possible.',
        'Do not fabricate chains; only include chain when explicit in user input or memo.',
      ],
      examples: [
        {
          query: 'Aster和Hyper谁更适合投资，为什么？',
          expectedTaskType: 'comparison',
          expectedEntities: ['ASTER', 'HYPER'],
        },
        {
          query: '我想看下PEPE现在风险',
          expectedTaskType: 'single_asset',
          expectedEntities: ['PEPE'],
        },
      ],
    };
    const prompts = buildIntentPrompts(context);
    return this.llmRuntime.generateStructured({
      nodeName: 'intent',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: intentOutputSchema,
      fallback: () => fallback,
    });
  }

  private buildDeterministicIntent(input: ParseIntentInput): IntentOutput {
    const normalized = input.query.toLowerCase();
    const language = /[\u4e00-\u9fff]/.test(input.query) ? 'zh' : 'en';
    const objective = this.detectObjective(normalized);
    const sentimentBias = this.detectSentiment(normalized);
    const focusAreas = this.detectFocusAreas(normalized);
    const extractedEntities = this.extractEntities(input.query);
    const extractedSymbols = this.extractSymbols(input.query);
    const memoEntities = [
      ...(input.memo?.lastIntent.entities ?? []),
      ...(input.memo?.lastResolvedTargets ?? []).map((item) =>
        item.identity.symbol.toUpperCase(),
      ),
    ];
    const memoSymbols = [
      ...(input.memo?.lastIntent.symbols ?? []),
      ...(input.memo?.lastResolvedTargets ?? []).map((item) =>
        item.identity.symbol.toUpperCase(),
      ),
    ];
    const memoChains = [
      ...(input.memo?.lastIntent.chains ?? []),
      ...(input.memo?.lastResolvedTargets ?? []).map((item) =>
        item.identity.chain.toLowerCase(),
      ),
    ];
    const entities =
      extractedEntities.length > 0
        ? extractedEntities
        : [...new Set(memoEntities)];
    const symbols =
      extractedSymbols.length > 0
        ? extractedSymbols
        : [...new Set(memoSymbols)];
    const taskType = this.detectTaskType(entities, symbols);
    const chains = input.preferredChain
      ? [input.preferredChain.toLowerCase()]
      : memoChains.length > 0
        ? [...new Set(memoChains)]
        : [];

    return {
      userQuery: input.query,
      language,
      taskType,
      objective,
      sentimentBias,
      timeWindow: input.timeWindow,
      entities,
      symbols,
      chains,
      focusAreas,
      constraints: ['hard_risk_controls', 'degraded_data_must_be_explicit'],
    };
  }

  private detectTaskType(
    entities: string[],
    symbols: string[],
  ): IntentOutput['taskType'] {
    const targetCount = new Set([...entities, ...symbols]).size;

    if (targetCount >= 2) {
      return 'comparison';
    }
    return 'single_asset';
  }

  private detectObjective(query: string): IntentOutput['objective'] {
    if (
      query.includes('风险') ||
      query.includes('安全') ||
      query.includes('risk') ||
      query.includes('安全性')
    ) {
      return 'risk_check';
    }
    if (
      query.includes('新闻') ||
      query.includes('公告') ||
      query.includes('news')
    ) {
      return 'news_focus';
    }
    if (
      query.includes('代币经济') ||
      query.includes('解锁') ||
      query.includes('通胀') ||
      query.includes('tokenomics')
    ) {
      return 'tokenomics_focus';
    }
    if (
      query.includes('买') ||
      query.includes('卖') ||
      query.includes('进场') ||
      query.includes('出场') ||
      query.includes('timing') ||
      query.includes('entry') ||
      query.includes('enter') ||
      query.includes('exit')
    ) {
      return 'timing_decision';
    }
    return 'market_overview';
  }

  private detectSentiment(query: string): IntentOutput['sentimentBias'] {
    if (
      query.includes('看多') ||
      query.includes('bull') ||
      query.includes('利好') ||
      query.includes('上涨')
    ) {
      return 'bullish';
    }
    if (
      query.includes('看空') ||
      query.includes('bear') ||
      query.includes('利空') ||
      query.includes('下跌')
    ) {
      return 'bearish';
    }
    if (query.includes('中性') || query.includes('neutral')) {
      return 'neutral';
    }
    return 'unknown';
  }

  private detectFocusAreas(query: string): IntentOutput['focusAreas'] {
    const focus = new Set<IntentOutput['focusAreas'][number]>();

    if (
      query.includes('价格') ||
      query.includes('price') ||
      query.includes('行情')
    ) {
      focus.add('price_action');
    }
    if (
      query.includes('新闻') ||
      query.includes('公告') ||
      query.includes('news')
    ) {
      focus.add('news_events');
    }
    if (
      query.includes('代币经济') ||
      query.includes('解锁') ||
      query.includes('tokenomics') ||
      query.includes('通胀')
    ) {
      focus.add('tokenomics');
    }
    if (
      query.includes('技术') ||
      query.includes('technical') ||
      query.includes('rsi') ||
      query.includes('macd') ||
      query.includes('均线')
    ) {
      focus.add('technical_indicators');
    }
    if (
      query.includes('链上') ||
      query.includes('净流') ||
      query.includes('onchain')
    ) {
      focus.add('onchain_flow');
    }
    if (
      query.includes('风险') ||
      query.includes('安全') ||
      query.includes('honeypot')
    ) {
      focus.add('security_risk');
    }
    if (
      query.includes('流动性') ||
      query.includes('池子') ||
      query.includes('liquidity')
    ) {
      focus.add('liquidity_quality');
    }

    if (focus.size === 0) {
      focus.add('price_action');
      focus.add('technical_indicators');
      focus.add('onchain_flow');
      focus.add('security_risk');
      focus.add('liquidity_quality');
    }

    return [...focus];
  }

  private extractSymbols(query: string): string[] {
    const upperTokens = query.match(/\b[A-Z]{2,10}\b/g) ?? [];
    return [...new Set(upperTokens)];
  }

  private extractEntities(query: string): string[] {
    const englishTokens = query.match(/[A-Za-z][A-Za-z0-9_-]{1,19}/g) ?? [];
    const stopWords = new Set([
      'PLEASE',
      'HELP',
      'LOOK',
      'CHECK',
      'SHOULD',
      'CAN',
      'COULD',
      'WOULD',
      'WILL',
      'ANALYZE',
      'ANALYSIS',
      'WHAT',
      'WHICH',
      'WHO',
      'WHERE',
      'WHEN',
      'WHY',
      'HOW',
      'MORE',
      'MOST',
      'BETTER',
      'WORTH',
      'INVEST',
      'INVESTMENT',
      'SHORT',
      'LONG',
      'RISK',
      'LIQUIDITY',
      'TOKEN',
      'COIN',
      'VS',
      'AND',
      'OR',
    ]);

    const entities: string[] = [];
    for (const token of englishTokens) {
      const looksLikeTicker = /^[A-Z]{2,10}$/.test(token);
      const looksLikeName = /^[A-Z][a-z0-9_-]{1,19}$/.test(token);
      if (!looksLikeTicker && !looksLikeName) {
        continue;
      }
      const upper = token.toUpperCase();
      if (stopWords.has(upper)) {
        continue;
      }
      if (!entities.includes(upper)) {
        entities.push(upper);
      }
    }
    return entities;
  }
}

import { Injectable } from '@nestjs/common';
import {
  IntentLlmOutput,
  IntentMemoSnapshot,
  IntentOutput,
  WorkflowNodeExecutionMeta,
  intentInteractionTypeSchema,
  intentLlmOutputSchema,
  intentOutputGoalSchema,
  intentOutputSchema,
  intentTaskTypeSchema,
} from '../../../data/contracts/workflow-contracts';
import { TOKEN_REGISTRY } from '../../data/market/native-tokens';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { buildIntentPrompts } from '../prompts';
import type { IntentPromptContext } from '../prompts';

type ParseIntentInput = {
  query: string;
  timeWindow: '24h' | '7d' | '30d' | '60d';
  preferredChain: string | null;
  language?: IntentOutput['language'];
  memo?: IntentMemoSnapshot | null;
};

@Injectable()
export class IntentNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async parse(input: ParseIntentInput): Promise<IntentOutput> {
    const result = await this.parseWithMeta(input);
    return result.intent;
  }

  async parseWithMeta(input: ParseIntentInput): Promise<{
    intent: IntentOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    const fallback = this.buildDeterministicIntentLlm(input);
    const context: IntentPromptContext = {
      query: input.query,
      defaultTimeWindow: input.timeWindow,
      preferredChain: input.preferredChain,
      interactionTypes: intentInteractionTypeSchema.options,
      taskTypes: intentTaskTypeSchema.options,
      outputGoals: intentOutputGoalSchema.options,
      tokenRegistry: this.buildTokenRegistryContext(),
      memo: input.memo
        ? {
            lastIntent: {
              interactionType: input.memo.lastIntent.interactionType,
              taskType: input.memo.lastIntent.taskType,
              outputGoal: input.memo.lastIntent.outputGoal,
              timeWindow: input.memo.lastIntent.timeWindow,
              entities: input.memo.lastIntent.entities,
              needsClarification: input.memo.lastIntent.needsClarification,
            },
            lastResolvedTargets: input.memo.lastResolvedTargets.map((item) => ({
              targetKey: item.targetKey,
              symbol: item.identity.symbol,
              chain: item.identity.chain,
            })),
          }
        : null,
      rules: [
        'Treat the current message as a workflow-routing task, not a market analysis task.',
        'Use follow_up when the user is clearly continuing or refining the previous topic in the thread.',
        'Use new_query when the user starts a fresh analysis request, even inside the same thread.',
        'Use comparison only when the user clearly wants cross-asset ranking or direct comparison.',
        'Use multi_asset when multiple assets are requested for separate analysis rather than ranking.',
        'If the message does not provide a stable analyzable target, set needsClarification=true.',
      ],
    };
    const prompts = buildIntentPrompts(context);
    const result = await this.llmRuntime.generateStructuredWithMeta({
      nodeName: 'intent',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: intentLlmOutputSchema,
      correctionGuidance: [
        'Keep the original meaning but return only the required six keys.',
        'targets must be a short string array and may be empty when clarification is needed.',
        'Do not add explanations or extra fields.',
      ],
      fallback: () => fallback,
    });

    return {
      intent: this.hydrateIntentOutput(result.data, input, fallback),
      meta: result.meta,
    };
  }

  private buildTokenRegistryContext(): IntentPromptContext['tokenRegistry'] {
    return Object.entries(TOKEN_REGISTRY).map(([symbol, meta]) => ({
      symbol,
      aliases: [
        symbol.toLowerCase(),
        ...(meta.displayName ? [meta.displayName.toLowerCase()] : []),
        ...(meta.aliases ?? []).map((alias) => alias.toLowerCase()),
      ],
      chain: meta.chain,
    }));
  }

  private buildDeterministicIntentLlm(
    input: ParseIntentInput,
  ): IntentLlmOutput {
    const extractedTargets = this.extractTargets(input.query);
    const interactionType = this.detectInteractionType(
      input.query,
      extractedTargets,
      input.memo ?? null,
    );
    const taskType = this.detectTaskType(
      input.query,
      extractedTargets,
      input.memo ?? null,
    );
    const outputGoal = this.detectOutputGoal(input.query, taskType);
    const explicitTimeWindow = this.detectExplicitTimeWindow(input.query);
    const hasUsableTargets =
      extractedTargets.length > 0 ||
      (interactionType === 'follow_up' &&
        this.getMemoFallbackTargets(input.memo ?? null).length > 0);

    return {
      interactionType,
      taskType,
      targets: extractedTargets,
      timeWindow: explicitTimeWindow,
      outputGoal,
      needsClarification: !hasUsableTargets,
    };
  }

  private hydrateIntentOutput(
    llmIntent: IntentLlmOutput,
    input: ParseIntentInput,
    fallback: IntentLlmOutput,
  ): IntentOutput {
    const normalized = this.normalizeLlmIntentOutput(llmIntent, fallback);
    const language =
      input.language === 'cn' ? 'zh' :
      input.language ?? (/[\u4e00-\u9fff]/.test(input.query) ? 'zh' : 'en');
    const entityMentions = this.resolveEntityMentions(
      normalized.targets,
      input.memo ?? null,
      normalized.interactionType,
    );
    const normalizedTargets = this.normalizeTargets(entityMentions);
    const entities =
      normalizedTargets.entities.length > 0
        ? normalizedTargets.entities
        : this.getMemoFallbackTargets(input.memo ?? null);
    const symbols =
      normalizedTargets.symbols.length > 0
        ? normalizedTargets.symbols
        : entities.filter((item) => item.length <= 15);
    const taskType = this.normalizeTaskType(normalized.taskType, entities);
    const outputGoal = this.normalizeOutputGoal(
      normalized.outputGoal,
      taskType,
      input.query,
    );
    const timeWindow =
      normalized.timeWindow === 'unspecified'
        ? input.timeWindow
        : normalized.timeWindow;
    const needsClarification =
      normalized.needsClarification ||
      entities.length === 0 ||
      (taskType === 'comparison' && entities.length < 2);
    const objective = this.detectObjective(input.query, outputGoal);
    const focusAreas = this.detectFocusAreas(
      input.query,
      outputGoal,
      taskType,
    );
    const chains = this.resolveChains(
      entities,
      input.preferredChain,
      input.memo ?? null,
    );

    return intentOutputSchema.parse({
      userQuery: input.query,
      language,
      interactionType: normalized.interactionType,
      taskType,
      outputGoal,
      needsClarification,
      objective,
      sentimentBias: 'unknown',
      timeWindow,
      entities,
      entityMentions,
      symbols,
      chains,
      focusAreas,
      constraints: this.buildConstraints(outputGoal, needsClarification),
    });
  }

  private normalizeLlmIntentOutput(
    intent: IntentLlmOutput,
    fallback: IntentLlmOutput,
  ): IntentLlmOutput {
    const targets = [...new Set(intent.targets.map((item) => item.trim()).filter(Boolean))]
      .slice(0, 5);
    const taskType = intentTaskTypeSchema.options.includes(intent.taskType)
      ? intent.taskType
      : fallback.taskType;
    const interactionType = intentInteractionTypeSchema.options.includes(
      intent.interactionType,
    )
      ? intent.interactionType
      : fallback.interactionType;
    const outputGoal = intentOutputGoalSchema.options.includes(intent.outputGoal)
      ? intent.outputGoal
      : fallback.outputGoal;

    return {
      interactionType,
      taskType,
      targets,
      timeWindow: intent.timeWindow ?? fallback.timeWindow,
      outputGoal,
      needsClarification: Boolean(intent.needsClarification),
    };
  }

  private detectInteractionType(
    query: string,
    extractedTargets: string[],
    memo: IntentMemoSnapshot | null,
  ): IntentLlmOutput['interactionType'] {
    const normalized = query.trim().toLowerCase();
    if (
      /^(选|选择|pick|choose|select)\b/i.test(normalized) ||
      /^#?\d+$/.test(normalized)
    ) {
      return 'selection_reply';
    }

    if (!memo) {
      return 'new_query';
    }

    // Fallback should stay structural and minimal: when we have thread memo but
    // no new explicit target, prefer follow-up. Primary semantic judgment is
    // still expected to come from the LLM.
    if (extractedTargets.length === 0) {
      return 'follow_up';
    }

    return 'new_query';
  }

  private detectTaskType(
    query: string,
    extractedTargets: string[],
    memo: IntentMemoSnapshot | null,
  ): IntentLlmOutput['taskType'] {
    const normalized = query.toLowerCase();
    const compareCues = [
      '对比',
      '比较',
      '谁更强',
      '哪个好',
      '哪个更',
      '哪个更适合',
      'vs',
      'versus',
      'compare',
      'comparison',
    ];
    const distinctTargetCount =
      extractedTargets.length > 0
        ? extractedTargets.length
        : memo?.lastIntent.taskType === 'comparison'
          ? memo.lastIntent.entities.length
          : 0;

    if (
      compareCues.some((cue) => normalized.includes(cue)) &&
      distinctTargetCount >= 2
    ) {
      return 'comparison';
    }

    if (extractedTargets.length >= 2) {
      return 'multi_asset';
    }

    if (
      memo?.lastIntent.taskType === 'comparison' &&
      distinctTargetCount >= 2 &&
      this.detectOutputGoal(query, 'comparison') === 'comparison'
    ) {
      return 'comparison';
    }

    return 'single_asset';
  }

  private detectOutputGoal(
    query: string,
    taskType: IntentLlmOutput['taskType'],
  ): IntentLlmOutput['outputGoal'] {
    const normalized = query.toLowerCase();
    if (taskType === 'comparison') {
      return 'comparison';
    }
    if (
      normalized.includes('策略') ||
      normalized.includes('建议') ||
      normalized.includes('怎么做') ||
      normalized.includes('配置') ||
      normalized.includes('strategy') ||
      normalized.includes('allocation')
    ) {
      return 'strategy';
    }
    return 'analysis';
  }

  private detectExplicitTimeWindow(
    query: string,
  ): IntentLlmOutput['timeWindow'] {
    const normalized = query.toLowerCase();
    if (
      normalized.includes('60天') ||
      normalized.includes('60d') ||
      normalized.includes('60 day') ||
      normalized.includes('60 days') ||
      normalized.includes('两个月') ||
      normalized.includes('二个月') ||
      normalized.includes('2 months')
    ) {
      return '60d';
    }
    if (
      normalized.includes('30天') ||
      normalized.includes('30d') ||
      normalized.includes('30 day') ||
      normalized.includes('30 days') ||
      normalized.includes('一个月') ||
      normalized.includes('本月') ||
      normalized.includes('月线') ||
      normalized.includes('month')
    ) {
      return '30d';
    }
    if (
      normalized.includes('7天') ||
      normalized.includes('7d') ||
      normalized.includes('一周') ||
      normalized.includes('这周') ||
      normalized.includes('本周') ||
      normalized.includes('week')
    ) {
      return '7d';
    }
    if (
      normalized.includes('24小时') ||
      normalized.includes('24h') ||
      normalized.includes('今天') ||
      normalized.includes('日内') ||
      normalized.includes('短线') ||
      normalized.includes('day')
    ) {
      return '24h';
    }
    return 'unspecified';
  }

  private extractTargets(query: string): string[] {
    const matched: string[] = [];
    const aliasMatches = this.buildAliasMatches();
    const ambiguousWords = new Set([
      'flow',
      'one',
      'near',
      'gas',
      'ray',
      'rose',
      'ark',
      'look',
      'check',
      'help',
      'should',
      'enter',
      'based',
      'technical',
      'onchain',
      'analysis',
      'analyze',
      'compare',
      'with',
      'versus',
      'worth',
      'invest',
    ]);
    const englishTokens = query.match(/[A-Za-z][A-Za-z0-9_-]{1,24}/g) ?? [];

    for (const token of englishTokens) {
      const lower = token.toLowerCase();
      if (ambiguousWords.has(lower)) {
        continue;
      }

      if (/^[A-Z]{2,10}$/.test(token)) {
        matched.push(token.toUpperCase());
        continue;
      }

      const aliasSymbols = aliasMatches.get(lower) ?? [];
      if (aliasSymbols.length === 1) {
        matched.push(token);
        continue;
      }

      if (/^[A-Z][a-z0-9_-]{1,24}$/.test(token)) {
        matched.push(token);
      }
    }

    return [...new Set(matched)].slice(0, 5);
  }

  private normalizeTargets(targets: string[]): {
    entities: string[];
    symbols: string[];
  } {
    const aliasMatches = this.buildAliasMatches();

    const canonical = new Set<string>();
    for (const item of targets) {
      const normalized = item.trim().toUpperCase();
      if (!normalized) {
        continue;
      }
      const matchedSymbols =
        aliasMatches.get(item.trim().toLowerCase()) ??
        aliasMatches.get(normalized.toLowerCase()) ??
        [];
      if (matchedSymbols.length === 1) {
        canonical.add(matchedSymbols[0]);
        continue;
      }
      canonical.add(normalized);
    }

    const entities = [...canonical];
    return {
      entities,
      symbols: entities.filter((item) => item.length <= 15),
    };
  }

  private buildAliasMatches(): Map<string, string[]> {
    const aliasMatches = new Map<string, string[]>();
    for (const [symbol, meta] of Object.entries(TOKEN_REGISTRY)) {
      const aliases = new Set([
        symbol.toLowerCase(),
        ...(meta.displayName ? [meta.displayName.toLowerCase()] : []),
        ...(meta.aliases ?? []).map((alias) => alias.toLowerCase()),
      ]);
      for (const alias of aliases) {
        if (!alias.trim()) {
          continue;
        }
        const existing = aliasMatches.get(alias) ?? [];
        if (!existing.includes(symbol)) {
          existing.push(symbol);
          aliasMatches.set(alias, existing);
        }
      }
    }
    return aliasMatches;
  }

  private getMemoFallbackTargets(memo: IntentMemoSnapshot | null): string[] {
    if (!memo) {
      return [];
    }
    const values = [
      ...memo.lastIntent.entities,
      ...memo.lastResolvedTargets.map((item) => item.identity.symbol),
    ];
    return [...new Set(values.map((item) => item.trim().toUpperCase()).filter(Boolean))];
  }

  private resolveEntityMentions(
    targets: string[],
    memo: IntentMemoSnapshot | null,
    interactionType: IntentOutput['interactionType'],
  ): string[] {
    const explicit = [...new Set(targets.map((item) => item.trim()).filter(Boolean))];
    if (explicit.length > 0) {
      return explicit;
    }

    if (interactionType === 'follow_up' && memo) {
      const memoMentions = memo.lastIntent.entityMentions.filter(Boolean);
      if (memoMentions.length > 0) {
        return [...new Set(memoMentions)];
      }
      return memo.lastResolvedTargets.map((item) => item.identity.symbol);
    }

    return [];
  }

  private resolveChains(
    entities: string[],
    preferredChain: string | null,
    memo: IntentMemoSnapshot | null,
  ): string[] {
    if (preferredChain?.trim()) {
      return [preferredChain.trim().toLowerCase()];
    }

    if (!memo) {
      return [];
    }

    const chainBySymbol = new Map(
      memo.lastResolvedTargets.map((item) => [
        item.identity.symbol.toUpperCase(),
        item.identity.chain.toLowerCase(),
      ]),
    );

    const chains = entities
      .map((entity) => chainBySymbol.get(entity.toUpperCase()) ?? null)
      .filter((chain): chain is string => Boolean(chain));

    return [...new Set(chains)];
  }

  private normalizeTaskType(
    taskType: IntentOutput['taskType'],
    entities: string[],
  ): IntentOutput['taskType'] {
    if (taskType === 'comparison' && entities.length >= 2) {
      return 'comparison';
    }
    if (entities.length >= 2) {
      return 'multi_asset';
    }
    return 'single_asset';
  }

  private normalizeOutputGoal(
    outputGoal: IntentOutput['outputGoal'],
    taskType: IntentOutput['taskType'],
    query: string,
  ): IntentOutput['outputGoal'] {
    if (taskType === 'comparison') {
      return 'comparison';
    }
    if (outputGoal === 'comparison') {
      return this.detectOutputGoal(query, taskType);
    }
    return outputGoal;
  }

  private detectObjective(
    query: string,
    outputGoal: IntentOutput['outputGoal'],
  ): IntentOutput['objective'] {
    const normalized = query.toLowerCase();
    if (this.isRelationshipQuery(normalized)) {
      return 'relationship_analysis';
    }
    if (
      normalized.includes('风险') ||
      normalized.includes('安全') ||
      normalized.includes('risk')
    ) {
      return 'risk_check';
    }
    if (
      normalized.includes('新闻') ||
      normalized.includes('公告') ||
      normalized.includes('news')
    ) {
      return 'news_focus';
    }
    if (
      normalized.includes('代币经济') ||
      normalized.includes('解锁') ||
      normalized.includes('通胀') ||
      normalized.includes('tokenomics')
    ) {
      return 'tokenomics_focus';
    }
    if (outputGoal === 'strategy') {
      return 'timing_decision';
    }
    return 'market_overview';
  }

  private detectFocusAreas(
    query: string,
    outputGoal: IntentOutput['outputGoal'],
    taskType: IntentOutput['taskType'],
  ): IntentOutput['focusAreas'] {
    const normalized = query.toLowerCase();
    const focus = new Set<IntentOutput['focusAreas'][number]>();

    if (
      normalized.includes('价格') ||
      normalized.includes('走势') ||
      normalized.includes('price') ||
      normalized.includes('trend')
    ) {
      focus.add('price_action');
    }
    if (
      normalized.includes('技术') ||
      normalized.includes('technical') ||
      normalized.includes('rsi') ||
      normalized.includes('macd')
    ) {
      focus.add('technical_indicators');
    }
    if (
      normalized.includes('链上') ||
      normalized.includes('onchain') ||
      normalized.includes('资金流')
    ) {
      focus.add('onchain_flow');
    }
    if (
      normalized.includes('安全') ||
      normalized.includes('风险') ||
      normalized.includes('honeypot')
    ) {
      focus.add('security_risk');
    }
    if (
      normalized.includes('流动性') ||
      normalized.includes('liquidity')
    ) {
      focus.add('liquidity_quality');
    }
    if (
      normalized.includes('基本面') ||
      normalized.includes('fundamental') ||
      normalized.includes('项目') ||
      normalized.includes('生态') ||
      normalized.includes('business') ||
      normalized.includes('业务')
    ) {
      focus.add('project_fundamentals');
    }
    if (
      normalized.includes('代币经济') ||
      normalized.includes('tokenomics') ||
      normalized.includes('解锁')
    ) {
      focus.add('tokenomics');
    }
    if (
      normalized.includes('新闻') ||
      normalized.includes('公告') ||
      normalized.includes('news')
    ) {
      focus.add('news_events');
    }

    if (outputGoal === 'strategy') {
      focus.add('technical_indicators');
      focus.add('onchain_flow');
      focus.add('security_risk');
      focus.add('liquidity_quality');
    }

    if (this.isRelationshipQuery(normalized)) {
      focus.add('project_fundamentals');
      focus.add('price_action');
      focus.add('news_events');
    }

    if (taskType === 'comparison') {
      focus.add('price_action');
      focus.add('technical_indicators');
      focus.add('security_risk');
    }

    if (focus.size === 0) {
      focus.add('price_action');
      focus.add('technical_indicators');
    }

    return [...focus];
  }

  private buildConstraints(
    outputGoal: IntentOutput['outputGoal'],
    needsClarification: boolean,
  ): string[] {
    const constraints = ['hard_risk_controls', 'degraded_data_must_be_explicit'];
    if (outputGoal === 'strategy') {
      constraints.push('actionable_strategy_required');
    }
    if (needsClarification) {
      constraints.push('clarification_required_before_confident_execution');
    }
    return constraints;
  }

  private isRelationshipQuery(normalizedQuery: string): boolean {
    const relationshipKeywords = [
      '关系',
      '关联',
      '联动',
      '绑定',
      '依赖',
      '受益于',
      '传导',
      '生态之间',
      '业务之间',
      '价值捕获',
      'capture value',
      'value capture',
      'relationship',
      'linked to',
      'correlation to',
      'depends on',
      'dependency',
      'ecosystem relation',
      'business linkage',
    ];

    return relationshipKeywords.some((keyword) =>
      normalizedQuery.includes(keyword),
    );
  }

}

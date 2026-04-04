import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AnalyzeCandidate,
  AnalyzeIdentity,
  FundamentalsSnapshot,
  NewsSnapshot,
  PriceSnapshot,
  TechnicalSnapshot,
} from '../../../data/contracts/analyze-contracts';
import { FundamentalsService } from '../../../modules/data/fundamentals/fundamentals.service';
import { MarketService } from '../../../modules/data/market/market.service';
import { NewsService } from '../../../modules/data/news/news.service';
import { SearcherService } from '../../../modules/data/searcher/searcher.service';
import { TechnicalService } from '../../../modules/data/technical/technical.service';
import { LlmRuntimeService } from '../../../modules/workflow/runtime/llm-runtime.service';
import type { RequestLang } from '../orchestration.types';
import {
  InstantConversationService,
  type InstantConversationState,
  type InstantTurnContext,
} from './instant-conversation.service';

type InstantReplyResult = {
  body: string;
  responseId: string | null;
  usedPreviousResponseId: boolean;
  usedLocalFallback: boolean;
  model: string;
  resolvedIdentity: AnalyzeIdentity | null;
  timeWindow: '24h' | '7d' | '30d' | '60d';
  goal: string | null;
  scope: InstantTurnContext['scope'];
  responseMode: InstantResponseMode;
};

type InstantResponseMode = 'explain' | 'assess' | 'act';

type InstantDataContext = {
  snapshotText: string | null;
  resolvedIdentity: AnalyzeIdentity | null;
  timeWindow: '24h' | '7d' | '30d' | '60d';
  goal: string | null;
  scope: InstantTurnContext['scope'];
  needsClarification: boolean;
  responseMode: InstantResponseMode;
};

const instantIntentSchema = z.object({
  assetDecision: z.enum(['explicit', 'inherit', 'none']),
  assetQuery: z.string().nullable(),
  timeDecision: z.enum(['explicit', 'inherit', 'none']),
  resolvedTimeWindow: z.enum(['24h', '7d', '30d', '60d']).nullable(),
  goalDecision: z.enum(['explicit', 'inherit', 'none']),
  resolvedGoal: z.string().nullable(),
  scopeDecision: z.enum(['explicit', 'inherit', 'none']),
  resolvedScope: z
    .enum(['single_asset', 'comparison', 'multi_asset', 'general'])
    .nullable(),
  needsClarification: z.boolean(),
});

type InstantIntentState = z.infer<typeof instantIntentSchema>;

@Injectable()
export class InstantChatService {
  private readonly systemPrompt = [
    'You are a senior crypto market assistant for fast Q&A.',
    'Your job is to provide quick but substantive answers, not a full research report.',
    '',
    '## Output Requirements',
    '1. Follow the supplied "Resolved response mode": explain, assess, or act.',
    '2. Keep the answer compact and useful, but do not compress explain or assess answers into a couple of throwaway lines.',
    '3. Use exact values from the verified snapshot when numbers are mentioned.',
    '4. If evidence is missing, say what is missing instead of guessing.',
    '5. Keep one clean Markdown structure from start to finish instead of mixing decorative labels, fragments, and bullets randomly.',
    '',
    '## Mode Rules',
    '- explain: answer what changed, why it matters, or how the mechanism works. Market and technical data are supporting evidence, not the whole answer. This mode may be visibly longer than act mode.',
    '- assess: answer whether the asset currently looks attractive or risky. Combine current market state with at least one business, news, or fundamentals fact when available. This mode should be fuller than a one-line verdict.',
    '- act: answer execution-style questions such as support, resistance, entry, exit, invalidation, or short-term setup. In this mode, price structure and technical levels can lead, and the answer can stay shorter.',
    '- When a mini table or mini level-map improves scanability, include one.',
    '',
    '## Rules:',
    '   - Only cite prices, indicators, levels, news items, and fundamentals facts that appear in the provided data snapshot',
    '   - Do NOT infer RSI, moving averages, Bollinger Bands, support, or resistance from price alone',
    '   - Do NOT turn explain or assess answers into trade checklists unless the response mode is act',
    '   - If data is missing, say what specific data is needed',
    '   - Do NOT make guaranteed-return claims',
    '   - Keep risk notes concise and concrete',
  ].join('\n');

  constructor(
    private readonly llm: LlmRuntimeService,
    private readonly conversations: InstantConversationService,
    private readonly searcher: SearcherService,
    private readonly market: MarketService,
    private readonly technical: TechnicalService,
    private readonly news: NewsService,
    private readonly fundamentals: FundamentalsService,
  ) {}

  async reply(input: {
    threadId: string;
    requestId: string;
    message: string;
    timeWindow: '24h' | '7d' | '30d' | '60d';
    lang: RequestLang;
  }): Promise<InstantReplyResult> {
    const conversation = this.conversations.get(input.threadId);
    const intentState = await this.resolveIntentState(
      input.message,
      input.timeWindow,
      conversation,
    );
    const dataContext = await this.collectDataContext(
      input.message,
      input.timeWindow,
      conversation,
      intentState,
    );
    const primaryPrompt = this.buildPrimaryPrompt(
      input.message,
      input.lang,
      dataContext,
    );

    try {
      const result = await this.llm.generateText({
        nodeName: 'instant',
        model: 'qwen3-max',
        systemPrompt: this.systemPrompt,
        userPrompt: primaryPrompt,
        previousResponseId: conversation?.lastResponseId ?? undefined,
        maxTokens: this.maxTokensForMode(dataContext.responseMode),
        timeoutMs: 45000,
      });

      this.conversations.saveTurn({
        threadId: input.threadId,
        requestId: input.requestId,
        userMessage: input.message,
        assistantMessage: this.normalizeInstantMarkdown(result.content),
        responseId: result.meta.responseId ?? null,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        turnContext: this.toTurnContext(dataContext),
      });

      return {
        body: this.normalizeInstantMarkdown(result.content),
        responseId: result.meta.responseId ?? null,
        usedPreviousResponseId: Boolean(conversation?.lastResponseId),
        usedLocalFallback: false,
        model: result.meta.model,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        responseMode: dataContext.responseMode,
      };
    } catch (error) {
      if (!conversation || conversation.turns.length === 0) {
        throw error;
      }

      const replayPrompt = this.buildReplayPrompt(
        this.conversations.buildFallbackTranscript(input.threadId),
        input.message,
        input.lang,
        dataContext,
      );
      const retried = await this.llm.generateText({
        nodeName: 'instant',
        model: 'qwen3-max',
        systemPrompt: this.systemPrompt,
        userPrompt: replayPrompt,
        maxTokens: this.maxTokensForMode(dataContext.responseMode),
        timeoutMs: 45000,
      });

      this.conversations.saveTurn({
        threadId: input.threadId,
        requestId: input.requestId,
        userMessage: input.message,
        assistantMessage: this.normalizeInstantMarkdown(retried.content),
        responseId: retried.meta.responseId ?? null,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        turnContext: this.toTurnContext(dataContext),
      });

      return {
        body: this.normalizeInstantMarkdown(retried.content),
        responseId: retried.meta.responseId ?? null,
        usedPreviousResponseId: false,
        usedLocalFallback: true,
        model: retried.meta.model,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        responseMode: dataContext.responseMode,
      };
    }
  }

  private buildPrimaryPrompt(
    message: string,
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const guidelines = this.outputGuidelines(lang, dataContext.responseMode);
    const parts = [
      `User question: ${message}`,
      `Observation window in use: ${dataContext.timeWindow}`,
      `Resolved goal: ${dataContext.goal ?? 'unspecified'}`,
      `Resolved scope: ${dataContext.scope ?? 'general'}`,
      `Resolved response mode: ${dataContext.responseMode}`,
      `Needs clarification: ${dataContext.needsClarification ? 'yes' : 'no'}`,
    ];

    if (dataContext.snapshotText) {
      parts.push(`Verified market snapshot:\n${dataContext.snapshotText}`);
    }

    parts.push(
      `Output language: ${this.toLanguageInstruction(lang)}`,
      '',
      'IMPORTANT:',
      '- Use only the verified market snapshot above',
      '- Include exact price, indicators, and evidence facts only when present in the snapshot',
      '- If support or resistance levels are unavailable, do not invent them',
      '- If some metrics are unavailable, simply omit them from the answer',
      `- Follow the ${dataContext.responseMode} mode rules strictly`,
      ...this.modeWritingDirectives(lang, dataContext.responseMode),
      ...this.markdownValidityRules(lang),
      '',
      'Return a compact quick-answer in valid Markdown.',
      ...guidelines,
      'Keep it readable and scannable. Do not turn it into a deep report, but do not under-answer explain or assess questions.',
    );

    return parts.join('\n');
  }

  private buildReplayPrompt(
    transcript: string,
    message: string,
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const guidelines = this.outputGuidelines(lang, dataContext.responseMode);
    const parts = [
      'Recent conversation from the same thread is provided below. Keep continuity, but do not repeat background unnecessarily.',
      transcript,
      '',
      `Current user question: ${message}`,
      `Observation window in use: ${dataContext.timeWindow}`,
      `Resolved goal: ${dataContext.goal ?? 'unspecified'}`,
      `Resolved scope: ${dataContext.scope ?? 'general'}`,
      `Resolved response mode: ${dataContext.responseMode}`,
      `Needs clarification: ${dataContext.needsClarification ? 'yes' : 'no'}`,
    ];

    if (dataContext.snapshotText) {
      parts.push(`Verified market snapshot:\n${dataContext.snapshotText}`);
    }

    parts.push(
      `Output language: ${this.toLanguageInstruction(lang)}`,
      'Use only the verified market snapshot for facts and numbers.',
      ...this.modeWritingDirectives(lang, dataContext.responseMode),
      ...this.markdownValidityRules(lang),
      'Return a compact quick-answer in valid Markdown.',
      ...guidelines,
      `Assume this is a fast follow-up in ${dataContext.responseMode} mode, not a report request.`,
    );

    return parts.join('\n');
  }

  private async resolveIntentState(
    message: string,
    fallbackTimeWindow: '24h' | '7d' | '30d' | '60d',
    conversation: InstantConversationState | null,
  ): Promise<InstantIntentState> {
    const fallback = this.buildFallbackIntentState(conversation);

    try {
      const result = await this.llm.generateText({
        nodeName: 'instant',
        model: 'qwen3-max',
        systemPrompt: [
          'You update the state for an instant crypto chat turn.',
          'You are not writing the market answer yet.',
          'Use the current user message, the previous resolved state, and the weighted history tracks.',
          'Decide each field independently: asset, time window, goal, and scope may each be explicit, inherited, or absent.',
          'Return strict JSON only with exactly these keys:',
          'assetDecision, assetQuery, timeDecision, resolvedTimeWindow, goalDecision, resolvedGoal, scopeDecision, resolvedScope, needsClarification',
          'Rules:',
          '- assetDecision=explicit only when the current message clearly points to a new or explicit asset mention.',
          '- assetDecision=inherit only when the message is clearly continuing the previous asset.',
          '- timeDecision=explicit only when the current message clearly changes or states the observation window.',
          '- timeDecision=inherit only when the message is a follow-up and keeps the prior window.',
          '- goalDecision and scopeDecision follow the same explicit vs inherit rule.',
          '- If something is not clear, prefer none instead of guessing.',
          '- resolvedScope must be one of single_asset, comparison, multi_asset, general, or null.',
        ].join('\n'),
        userPrompt: [
          `Current user message: ${message}`,
          `Fallback time window: ${fallbackTimeWindow}`,
          `Previous resolved state: ${this.buildPreviousStateSummary(conversation)}`,
          'Weighted recent user history:',
          this.buildWeightedUserHistory(conversation),
          'Asset track:',
          this.buildWeightedTrack(
            conversation,
            (turn) => turn.context?.assetMention ?? null,
          ),
          'Time track:',
          this.buildWeightedTrack(
            conversation,
            (turn) => turn.context?.timeWindow ?? null,
          ),
          'Goal track:',
          this.buildWeightedTrack(
            conversation,
            (turn) => turn.context?.goal ?? null,
          ),
          'Scope track:',
          this.buildWeightedTrack(
            conversation,
            (turn) => turn.context?.scope ?? null,
          ),
        ].join('\n'),
        maxTokens: 400,
        timeoutMs: 20000,
      });

      return this.parseIntentState(result.content, fallback);
    } catch {
      return fallback;
    }
  }

  private buildFallbackIntentState(
    conversation: InstantConversationState | null,
  ): InstantIntentState {
    return {
      assetDecision: 'none',
      assetQuery: null,
      timeDecision: conversation?.lastTimeWindow ? 'inherit' : 'none',
      resolvedTimeWindow: null,
      goalDecision: conversation?.lastGoal ? 'inherit' : 'none',
      resolvedGoal: null,
      scopeDecision: conversation?.lastScope ? 'inherit' : 'none',
      resolvedScope: null,
      needsClarification: false,
    };
  }

  private parseIntentState(
    content: string,
    fallback: InstantIntentState,
  ): InstantIntentState {
    const jsonBlock = this.extractJsonBlock(content);
    if (!jsonBlock) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(jsonBlock);
      const validated = instantIntentSchema.safeParse(parsed);
      return validated.success ? validated.data : fallback;
    } catch {
      return fallback;
    }
  }

  private extractJsonBlock(content: string): string | null {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return fenced[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return null;
    }

    return trimmed.slice(start, end + 1).trim();
  }

  private buildPreviousStateSummary(
    conversation: InstantConversationState | null,
  ): string {
    if (!conversation) {
      return 'none';
    }

    return JSON.stringify({
      asset: conversation.lastResolvedIdentity
        ? {
            symbol: conversation.lastResolvedIdentity.symbol,
            chain: conversation.lastResolvedIdentity.chain,
            sourceId: conversation.lastResolvedIdentity.sourceId,
          }
        : null,
      timeWindow: conversation.lastTimeWindow,
      goal: conversation.lastGoal,
      scope: conversation.lastScope,
    });
  }

  private buildWeightedUserHistory(
    conversation: InstantConversationState | null,
  ): string {
    const userTurns =
      conversation?.turns.filter((turn) => turn.role === 'user').slice(-6) ?? [];
    if (userTurns.length === 0) {
      return '- none';
    }

    return userTurns
      .map((turn, index, turns) => {
        const distanceFromLatest = turns.length - 1 - index;
        const weight = Math.max(0.35, 1 - distanceFromLatest * 0.2);
        return `- weight=${weight.toFixed(2)} | message=${turn.content}`;
      })
      .join('\n');
  }

  private buildWeightedTrack(
    conversation: InstantConversationState | null,
    pickValue: (
      turn: InstantConversationState['turns'][number],
    ) => string | null,
  ): string {
    const relevantTurns =
      conversation?.turns
        .filter((turn) => turn.role === 'user')
        .filter((turn) => Boolean(pickValue(turn)))
        .slice(-4) ?? [];

    if (relevantTurns.length === 0) {
      return '- none';
    }

    return relevantTurns
      .map((turn, index, turns) => {
        const distanceFromLatest = turns.length - 1 - index;
        const weight = Math.max(0.35, 1 - distanceFromLatest * 0.2);
        return `- weight=${weight.toFixed(2)} | value=${pickValue(turn)} | message=${turn.content}`;
      })
      .join('\n');
  }

  private async collectDataContext(
    message: string,
    fallbackTimeWindow: '24h' | '7d' | '30d' | '60d',
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): Promise<InstantDataContext> {
    const timeWindow = this.resolveTimeWindow(
      fallbackTimeWindow,
      conversation,
      intentState,
    );
    const goal = this.resolveGoal(conversation, intentState);
    const scope = this.resolveScope(conversation, intentState);
    const responseMode = this.inferResponseMode(message, goal, scope);

    const assetContext = await this.resolveAssetContext(
      message,
      conversation,
      intentState,
    );
    if (assetContext.kind === 'resolved') {
      const [market, technical, news, fundamentals] = await Promise.all([
        this.market.fetchPrice(assetContext.identity),
        this.technical.fetchSnapshot(assetContext.identity, timeWindow),
        this.shouldFetchSupplementalEvidence(responseMode)
          ? this.safeFetchLatestNews(assetContext.identity)
          : Promise.resolve<NewsSnapshot | null>(null),
        this.shouldFetchSupplementalEvidence(responseMode)
          ? this.safeFetchFundamentals(assetContext.identity)
          : Promise.resolve<FundamentalsSnapshot | null>(null),
      ]);

      return {
        snapshotText: this.buildResolvedSnapshot({
          identity: assetContext.identity,
          market,
          technical,
          timeWindow,
          responseMode,
          news,
          fundamentals,
        }),
        resolvedIdentity: assetContext.identity,
        timeWindow,
        goal,
        scope,
        needsClarification: intentState.needsClarification,
        responseMode,
      };
    }

    if (assetContext.kind === 'ambiguous') {
      return {
        snapshotText: this.buildAmbiguousSnapshot(assetContext.candidates),
        resolvedIdentity: null,
        timeWindow,
        goal,
        scope,
        needsClarification: true,
        responseMode,
      };
    }

    return {
      snapshotText: [
        'Asset resolution: unresolved',
        'No verified asset identity could be resolved from the user message.',
        'Do not provide token-specific prices or indicators without clarification.',
      ].join('\n'),
      resolvedIdentity: null,
      timeWindow,
      goal,
      scope,
      needsClarification: intentState.needsClarification,
      responseMode,
    };
  }

  private inferResponseMode(
    message: string,
    goal: string | null,
    scope: InstantTurnContext['scope'],
  ): InstantResponseMode {
    const text = `${message} ${goal ?? ''}`.toLowerCase();

    const actPatterns = [
      /support/,
      /resistance/,
      /stop[- ]?loss/,
      /entry/,
      /exit/,
      /take[- ]?profit/,
      /trigger/,
      /支撑/,
      /阻力/,
      /压力位/,
      /止损/,
      /止盈/,
      /入场/,
      /出场/,
      /买点/,
      /卖点/,
      /仓位/,
      /怎么设/,
      /操作/,
    ];
    if (actPatterns.some((pattern) => pattern.test(text))) {
      return 'act';
    }

    const assessPatterns = [
      /能买吗/,
      /可以买/,
      /适合投资/,
      /值得买/,
      /值不值得/,
      /风险/,
      /can i buy/,
      /should i buy/,
      /worth buying/,
      /invest/,
      /investment/,
      /attractive/,
      /估值/,
      /配置/,
    ];
    if (assessPatterns.some((pattern) => pattern.test(text))) {
      return 'assess';
    }

    if (scope === 'comparison' || scope === 'multi_asset') {
      return 'explain';
    }

    return 'explain';
  }

  private shouldFetchSupplementalEvidence(
    responseMode: InstantResponseMode,
  ): boolean {
    return responseMode === 'explain' || responseMode === 'assess';
  }

  private async safeFetchLatestNews(
    identity: AnalyzeIdentity,
  ): Promise<NewsSnapshot | null> {
    try {
      return await this.news.fetchLatest(identity, 3);
    } catch {
      return null;
    }
  }

  private async safeFetchFundamentals(
    identity: AnalyzeIdentity,
  ): Promise<FundamentalsSnapshot | null> {
    try {
      return await this.fundamentals.fetchSnapshot(identity);
    } catch {
      return null;
    }
  }

  private resolveTimeWindow(
    fallbackTimeWindow: '24h' | '7d' | '30d' | '60d',
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): '24h' | '7d' | '30d' | '60d' {
    if (
      intentState.timeDecision === 'explicit' &&
      intentState.resolvedTimeWindow
    ) {
      return intentState.resolvedTimeWindow;
    }

    if (
      intentState.timeDecision === 'inherit' &&
      conversation?.lastTimeWindow
    ) {
      return conversation.lastTimeWindow;
    }

    return fallbackTimeWindow;
  }

  private resolveGoal(
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): string | null {
    if (
      intentState.goalDecision === 'explicit' &&
      intentState.resolvedGoal?.trim()
    ) {
      return intentState.resolvedGoal.trim();
    }

    if (intentState.goalDecision === 'inherit') {
      return conversation?.lastGoal ?? null;
    }

    return null;
  }

  private resolveScope(
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): InstantTurnContext['scope'] {
    if (
      intentState.scopeDecision === 'explicit' &&
      intentState.resolvedScope
    ) {
      return intentState.resolvedScope;
    }

    if (intentState.scopeDecision === 'inherit') {
      return conversation?.lastScope ?? null;
    }

    return null;
  }

  private async resolveAssetContext(
    message: string,
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): Promise<
    | { kind: 'resolved'; identity: AnalyzeIdentity }
    | { kind: 'ambiguous'; candidates: AnalyzeCandidate[] }
    | { kind: 'unresolved' }
  > {
    if (
      intentState.assetDecision === 'inherit' &&
      conversation?.lastResolvedIdentity
    ) {
      return {
        kind: 'resolved',
        identity: conversation.lastResolvedIdentity,
      };
    }

    if (intentState.assetDecision === 'inherit') {
      return {
        kind: 'unresolved',
      };
    }

    const queries =
      intentState.assetDecision === 'explicit' &&
      intentState.assetQuery &&
      intentState.assetQuery.trim() !== message.trim()
        ? [intentState.assetQuery.trim(), message]
        : [message];

    for (const query of queries) {
      const resolved = await this.searcher.resolve(query);
      if (resolved.kind === 'resolved') {
        return {
          kind: 'resolved',
          identity: resolved.identity,
        };
      }

      if (resolved.kind === 'ambiguous') {
        return {
          kind: 'ambiguous',
          candidates: resolved.candidates,
        };
      }
    }

    return {
      kind: 'unresolved',
    };
  }

  private toTurnContext(dataContext: InstantDataContext): Partial<InstantTurnContext> {
    return {
      assetMention: dataContext.resolvedIdentity?.symbol ?? null,
      timeWindow: dataContext.timeWindow,
      goal: dataContext.goal,
      scope: dataContext.scope,
    };
  }

  private toLanguageInstruction(lang: RequestLang): string {
    return lang === 'en' ? 'English' : 'Simplified Chinese';
  }

  private maxTokensForMode(responseMode: InstantResponseMode): number {
    if (responseMode === 'explain') {
      return 1600;
    }
    if (responseMode === 'assess') {
      return 1300;
    }
    return 900;
  }

  private modeWritingDirectives(
    lang: RequestLang,
    responseMode: InstantResponseMode,
  ): string[] {
    if (lang === 'en') {
      if (responseMode === 'explain') {
        return [
          '- Aim for a fuller quick answer: usually 3 to 5 short blocks or paragraphs.',
          '- Explain mechanism, current evidence, and what is still unverified.',
          '- If it helps, include one compact markdown table or one mini visual block.',
        ];
      }

      if (responseMode === 'assess') {
        return [
          '- Aim for a medium quick answer: usually 3 to 4 short blocks or paragraphs.',
          '- Include the judgment, why now, and the main risk or condition change.',
          '- If it helps, include one compact markdown table or one mini visual block.',
        ];
      }

      return [
        '- Keep this one shorter and execution-focused.',
        '- A compact mini level-map is encouraged when levels are available.',
      ];
    }

    if (responseMode === 'explain') {
      return [
        '- 这一类快答可以稍长，通常写成 3 到 5 个短块，不要只给两三句。',
        '- 重点写清机制、当前证据、以及还缺什么验证。',
        '- 如果有助于扫读，可以加 1 个紧凑 markdown 表或 1 个小型图形块。',
      ];
    }

    if (responseMode === 'assess') {
      return [
        '- 这一类快答建议写成 3 到 4 个短块，不能只有一句判断。',
        '- 至少要写清当前判断、为什么是现在、以及主要风险或反转条件。',
        '- 如果有助于扫读，可以加 1 个紧凑 markdown 表或 1 个小型图形块。',
      ];
    }

    return [
      '- 这一类快答保持更短，偏执行和关键位。',
      '- 如果关键位存在，优先给一个紧凑的小型价位图块。',
    ];
  }

  private markdownValidityRules(lang: RequestLang): string[] {
    if (lang === 'en') {
      return [
        '- Output renderer-safe Markdown only.',
        '- Use headings, bullet lists, tables, and fenced code blocks only when they are clean and valid.',
        '- Leave a blank line before and after tables and fenced code blocks.',
        '- Do not use decorative bold label prefixes such as `**Verdict:**` or `**Action:**`; use a normal paragraph or a real heading instead.',
        '- If you start a numbered list, keep the numbering contiguous and stable.',
        '- Do not leave blank lines between table rows.',
        '- If you use a table, keep column counts consistent and include a header row.',
      ];
    }

    return [
      '- 只输出可稳定解析的 Markdown。',
      '- 标题、列表、表格、代码块都可以用，但必须写得规范。',
      '- 表格和 fenced code block 前后都要留空行。',
      '- 不要写 `**结论：**`、`**行动建议：**` 这类装饰性加粗标签；正常段落或真实标题更好。',
      '- 如果使用编号列表，编号要连续稳定。',
      '- 表格内部行与行之间不要插空行。',
      '- 如果使用表格，必须有表头，且列数保持一致。',
    ];
  }

  private outputGuidelines(
    lang: RequestLang,
    responseMode: InstantResponseMode,
  ): string[] {
    if (lang === 'en') {
      if (responseMode === 'act') {
        return [
          '- Start with a short execution conclusion.',
          '- Then use a short paragraph, bullets, a small table, or a small fenced code block when helpful.',
          '- Cover setup, action, and risk clearly, but stay concise.',
        ];
      }

      if (responseMode === 'assess') {
        return [
          '- Start with a short investment judgment.',
          '- Use 3 to 4 short blocks when evidence is available.',
          '- Cover why now, the main risk, and what would change the view.',
        ];
      }

      return [
        '- Start with a short explanatory conclusion.',
        '- Use 3 to 5 short blocks when evidence is available.',
        '- Cover mechanism or reason, evidence, and what is still uncertain.',
      ];
    }

    if (responseMode === 'act') {
      return [
        '- 开头先给一句简短的执行判断。',
        '- 后面可按需要使用短段落、列表、小表格或小型代码块。',
        '- 把盘面依据、动作和风险写清楚，但保持简洁。',
      ];
    }

    if (responseMode === 'assess') {
      return [
        '- 开头先给一句简短的投资判断。',
        '- 有证据时通常写成 3 到 4 个短块。',
        '- 至少覆盖为什么是现在、主要风险、以及什么会改变判断。',
      ];
    }

    return [
      '- 开头先给一句简短的解释型结论。',
      '- 有证据时通常写成 3 到 5 个短块。',
      '- 至少覆盖机制或原因、证据、以及还不确定什么。',
    ];
  }

  private normalizeInstantMarkdown(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const lines = normalized
      .split('\n')
      .map((line) => this.normalizeDecorativeLabelLine(line));
    const out: string[] = [];
    let inFence = false;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].replace(/[ \t]+$/g, '');
      const prev = out.length > 0 ? out[out.length - 1] : null;
      const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const trimmed = line.trim();
      const isFence = trimmed.startsWith('```');
      const isTableRow = /^\|.*\|$/.test(trimmed);
      const isBullet = /^[-*]\s+/.test(trimmed);
      const isNumberedItem = /^\d+\.\s+/.test(trimmed);
      const isHeading = /^#{1,6}\s+/.test(trimmed);
      const prevIsTableRow = prev ? /^\|.*\|$/.test(prev.trim()) : false;
      const nextIsTableRow = /^\|.*\|$/.test(next);

      if (isFence) {
        if (!inFence && prev && prev.trim() !== '') {
          out.push('');
        }
        out.push(line);
        if (inFence && next) {
          out.push('');
        }
        inFence = !inFence;
        continue;
      }

      if (inFence) {
        out.push(line);
        continue;
      }

      if (isHeading && prev && prev.trim() !== '') {
        out.push('');
      }

      if (isTableRow && !prevIsTableRow && prev && prev.trim() !== '') {
        out.push('');
      }

      if (
        (isBullet || isNumberedItem) &&
        prev &&
        prev.trim() !== '' &&
        !/^\s*$/.test(prev)
      ) {
        const prevTrimmed = prev.trim();
        if (
          !prevTrimmed.startsWith('- ') &&
          !prevTrimmed.startsWith('* ') &&
          !/^\d+\.\s+/.test(prevTrimmed) &&
          !prevTrimmed.startsWith('|') &&
          !prevTrimmed.startsWith('```') &&
          !prevTrimmed.startsWith('#')
        ) {
          out.push('');
        }
      }

      out.push(line);

      if (isHeading && next && !next.startsWith('#') && next !== '```') {
        out.push('');
      }

      if (isTableRow && !nextIsTableRow && next && next !== '```') {
        out.push('');
      }
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private normalizeDecorativeLabelLine(line: string): string {
    const trimmed = line.trim();
    if (trimmed === '') {
      return '';
    }

    const bulletInlineLabel = line.match(
      /^(\s*[-*]\s+)\*\*([^*]+?)\*\*[:：]?\s+(.+)$/,
    );
    if (bulletInlineLabel?.[1] && bulletInlineLabel?.[2] && bulletInlineLabel?.[3]) {
      const prefix = bulletInlineLabel[1];
      const label = bulletInlineLabel[2].replace(/[:：]\s*$/, '').trim();
      const rest = bulletInlineLabel[3].trim();
      return `${prefix}${label}：${rest}`;
    }

    const bulletStandaloneLabel = line.match(/^\s*([-*]\s+)\*\*([^*]+?)\*\*[:：]?$/);
    if (bulletStandaloneLabel?.[1] && bulletStandaloneLabel?.[2]) {
      const prefix = bulletStandaloneLabel[1];
      const label = bulletStandaloneLabel[2].replace(/[:：]\s*$/, '').trim();
      return `${prefix}${label}`;
    }

    const standaloneLabel = trimmed.match(/^\*\*([^*]+?)\*\*[:：]?$/);
    if (standaloneLabel?.[1]) {
      return `### ${standaloneLabel[1].replace(/[:：]\s*$/, '').trim()}`;
    }

    const inlineLabel = trimmed.match(/^\*\*([^*]+?)\*\*[:：]?\s+(.+)$/);
    if (inlineLabel?.[1] && inlineLabel?.[2]) {
      const label = inlineLabel[1].replace(/[:：]\s*$/, '').trim();
      const rest = inlineLabel[2].trim();
      return `${label}：${rest}`;
    }

    return line;
  }

  private buildResolvedSnapshot(input: {
    identity: AnalyzeIdentity;
    market: PriceSnapshot;
    technical: TechnicalSnapshot;
    timeWindow: '24h' | '7d' | '30d' | '60d';
    responseMode: InstantResponseMode;
    news: NewsSnapshot | null;
    fundamentals: FundamentalsSnapshot | null;
  }): string {
    const lines = [
      'Asset resolution: resolved',
      `Symbol: ${input.identity.symbol}`,
      `Chain: ${input.identity.chain}`,
      `Token address: ${input.identity.tokenAddress || 'n/a'}`,
      `Source ID: ${input.identity.sourceId}`,
      `Response mode: ${input.responseMode}`,
      'Market snapshot:',
      `- Price USD: ${this.formatNumber(input.market.priceUsd)}`,
      `- Change 24h pct: ${this.formatSignedNumber(input.market.change24hPct)}`,
      `- Change 7d pct: ${this.formatSignedNumber(input.market.change7dPct)}`,
      `- Change 30d pct: ${this.formatSignedNumber(input.market.change30dPct)}`,
      `- Volume 24h USD: ${this.formatNumber(input.market.totalVolume24hUsd)}`,
      `- Market cap USD: ${this.formatNumber(input.market.marketCapUsd)}`,
      `- Market cap rank: ${this.formatNumber(input.market.marketCapRank)}`,
      `- ATH USD: ${this.formatNumber(input.market.athUsd)}`,
      `- ATL USD: ${this.formatNumber(input.market.atlUsd)}`,
      `- Market as of: ${input.market.asOf}`,
      `Technical snapshot (${input.timeWindow} view):`,
      `- RSI14: ${this.formatNumber(input.technical.rsi.value)}`,
      `- MACD: ${this.formatNumber(input.technical.macd.macd)}`,
      `- MACD signal line: ${this.formatNumber(input.technical.macd.signalLine)}`,
      `- MACD histogram: ${this.formatNumber(input.technical.macd.histogram)}`,
      `- MA7: ${this.formatNumber(input.technical.ma.ma7)}`,
      `- MA25: ${this.formatNumber(input.technical.ma.ma25)}`,
      `- MA99: ${this.formatNumber(input.technical.ma.ma99)}`,
      `- Bollinger upper: ${this.formatNumber(input.technical.boll.upper)}`,
      `- Bollinger middle: ${this.formatNumber(input.technical.boll.middle)}`,
      `- Bollinger lower: ${this.formatNumber(input.technical.boll.lower)}`,
      `- Swing high: ${this.formatNumber(input.technical.swingHigh)}`,
      `- Swing low: ${this.formatNumber(input.technical.swingLow)}`,
      `- Technical summary signal: ${input.technical.summarySignal}`,
      `- Technical as of: ${input.technical.asOf}`,
      'Mini visual candidates:',
      `- Level map anchor: swingLow=${this.formatNumber(input.technical.swingLow)} | price=${this.formatNumber(input.market.priceUsd)} | swingHigh=${this.formatNumber(input.technical.swingHigh)}`,
      `- Trend ladder: MA25=${this.formatNumber(input.technical.ma.ma25)} | MA7=${this.formatNumber(input.technical.ma.ma7)} | price=${this.formatNumber(input.market.priceUsd)}`,
      'Support/resistance guidance:',
      '- Prefer Bollinger, MA, swing high, and swing low as candidate levels only when numeric values exist.',
    ];

    const newsLines = this.buildNewsSnapshotLines(input.news);
    if (newsLines.length > 0) {
      lines.push('Recent external evidence:', ...newsLines);
    }

    const fundamentalsLines = this.buildFundamentalsSnapshotLines(
      input.fundamentals,
    );
    if (fundamentalsLines.length > 0) {
      lines.push('Fundamentals snapshot:', ...fundamentalsLines);
    }

    return lines.join('\n');
  }

  private buildNewsSnapshotLines(snapshot: NewsSnapshot | null): string[] {
    if (!snapshot || snapshot.degraded || snapshot.items.length === 0) {
      return [];
    }

    return snapshot.items.slice(0, 3).map((item) => {
      const date = item.publishedAt.slice(0, 10);
      return `- ${date} | ${item.source} | ${item.title}`;
    });
  }

  private buildFundamentalsSnapshotLines(
    snapshot: FundamentalsSnapshot | null,
  ): string[] {
    if (!snapshot || snapshot.degraded) {
      return [];
    }

    const lines: string[] = [];
    if (snapshot.profile.oneLiner) {
      lines.push(`- One-liner: ${snapshot.profile.oneLiner}`);
    }
    if (snapshot.profile.totalFundingUsd !== null) {
      lines.push(
        `- Total funding USD: ${this.formatNumber(snapshot.profile.totalFundingUsd)}`,
      );
    }
    if (snapshot.investors.length > 0) {
      lines.push(
        `- Named investors: ${snapshot.investors
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ')}`,
      );
    }
    if (snapshot.fundraising.length > 0) {
      const latest = snapshot.fundraising[0];
      lines.push(
        `- Latest fundraising: ${latest.round ?? 'unknown'} | ${this.formatNumber(latest.amountUsd)} | ${latest.publishedAt ?? 'date unavailable'}`,
      );
    }
    const ecosystemHooks = [
      ...snapshot.ecosystems.onMainNet,
      ...snapshot.ecosystems.planToLaunch,
      ...snapshot.ecosystems.ecosystems,
    ].filter(Boolean);
    if (ecosystemHooks.length > 0) {
      lines.push(
        `- Ecosystem hooks: ${ecosystemHooks.slice(0, 3).join(', ')}`,
      );
    }
    if (snapshot.social.followers !== null) {
      lines.push(
        `- Social followers: ${this.formatNumber(snapshot.social.followers)}`,
      );
    }

    return lines;
  }

  private buildAmbiguousSnapshot(candidates: AnalyzeCandidate[]): string {
    const options = candidates
      .slice(0, 5)
      .map(
        (candidate, index) =>
          `${index + 1}. ${candidate.symbol} | ${candidate.tokenName} | ${candidate.chain} | ${candidate.tokenAddress}`,
      );

    return [
      'Asset resolution: ambiguous',
      'Multiple candidate assets matched the user message.',
      'Ask the user to specify the exact symbol or chain before giving token-specific numbers.',
      'Candidates:',
      ...options,
    ].join('\n');
  }

  private formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return 'unavailable';
    }
    return String(value);
  }

  private formatSignedNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return 'unavailable';
    }
    return `${value > 0 ? '+' : ''}${value}`;
  }
}

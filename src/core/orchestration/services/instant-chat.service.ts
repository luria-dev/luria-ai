import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AnalyzeCandidate,
  AnalyzeIdentity,
  PriceSnapshot,
  TechnicalSnapshot,
} from '../../../data/contracts/analyze-contracts';
import { MarketService } from '../../../modules/data/market/market.service';
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
  timeWindow: '24h' | '7d' | '30d';
  goal: string | null;
  scope: InstantTurnContext['scope'];
};

type InstantDataContext = {
  snapshotText: string | null;
  resolvedIdentity: AnalyzeIdentity | null;
  timeWindow: '24h' | '7d' | '30d';
  goal: string | null;
  scope: InstantTurnContext['scope'];
  needsClarification: boolean;
};

const instantIntentSchema = z.object({
  assetDecision: z.enum(['explicit', 'inherit', 'none']),
  assetQuery: z.string().nullable(),
  timeDecision: z.enum(['explicit', 'inherit', 'none']),
  resolvedTimeWindow: z.enum(['24h', '7d', '30d']).nullable(),
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
    '1. ALWAYS include these if available:',
    '   - Current price',
    '   - 24h change percentage',
    '   - Key support and resistance levels',
    '2. When mentioning technical indicators, include specific values:',
    '   - RSI value (e.g., "RSI 45" not just "RSI neutral")',
    '   - Moving averages (MA7, MA25, MA99 positions)',
    '   - Bollinger Bands position',
    '3. Format requirements:',
    '   - First line: Quick conclusion with price and trend',
    '   - Use 2-3 short paragraphs maximum',
    '   - Include specific numbers, not vague statements',
    '4. Rules:',
    '   - Only cite prices, indicators, and levels that appear in the provided data snapshot',
    '   - Do NOT infer RSI, moving averages, Bollinger Bands, support, or resistance from price alone',
    '   - If data is missing, say what specific data is needed',
    '   - Do NOT make guaranteed-return claims',
    '   - Keep risk notes to one sentence',
  ].join('\n');

  constructor(
    private readonly llm: LlmRuntimeService,
    private readonly conversations: InstantConversationService,
    private readonly searcher: SearcherService,
    private readonly market: MarketService,
    private readonly technical: TechnicalService,
  ) {}

  async reply(input: {
    threadId: string;
    requestId: string;
    message: string;
    timeWindow: '24h' | '7d' | '30d';
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
        maxTokens: 900,
        timeoutMs: 45000,
      });

      this.conversations.saveTurn({
        threadId: input.threadId,
        requestId: input.requestId,
        userMessage: input.message,
        assistantMessage: result.content,
        responseId: result.meta.responseId ?? null,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        turnContext: this.toTurnContext(dataContext),
      });

      return {
        body: result.content,
        responseId: result.meta.responseId ?? null,
        usedPreviousResponseId: Boolean(conversation?.lastResponseId),
        usedLocalFallback: false,
        model: result.meta.model,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
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
        maxTokens: 900,
        timeoutMs: 45000,
      });

      this.conversations.saveTurn({
        threadId: input.threadId,
        requestId: input.requestId,
        userMessage: input.message,
        assistantMessage: retried.content,
        responseId: retried.meta.responseId ?? null,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
        turnContext: this.toTurnContext(dataContext),
      });

      return {
        body: retried.content,
        responseId: retried.meta.responseId ?? null,
        usedPreviousResponseId: false,
        usedLocalFallback: true,
        model: retried.meta.model,
        resolvedIdentity: dataContext.resolvedIdentity,
        timeWindow: dataContext.timeWindow,
        goal: dataContext.goal,
        scope: dataContext.scope,
      };
    }
  }

  private buildPrimaryPrompt(
    message: string,
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      `User question: ${message}`,
      `Observation window in use: ${dataContext.timeWindow}`,
      `Resolved goal: ${dataContext.goal ?? 'unspecified'}`,
      `Resolved scope: ${dataContext.scope ?? 'general'}`,
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
      '- Include exact price, 24h change, and indicators only when present in the snapshot',
      '- If support or resistance levels are unavailable, do not invent them',
      '- If some metrics are unavailable, simply omit them from the answer',
      '',
      'Return a compact quick-answer in Markdown using this exact structure:',
      ...template,
      'Keep it to 2-3 paragraphs max. Do not turn it into a mini report.',
    );

    return parts.join('\n');
  }

  private buildReplayPrompt(
    transcript: string,
    message: string,
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      'Recent conversation from the same thread is provided below. Keep continuity, but do not repeat background unnecessarily.',
      transcript,
      '',
      `Current user question: ${message}`,
      `Observation window in use: ${dataContext.timeWindow}`,
      `Resolved goal: ${dataContext.goal ?? 'unspecified'}`,
      `Resolved scope: ${dataContext.scope ?? 'general'}`,
      `Needs clarification: ${dataContext.needsClarification ? 'yes' : 'no'}`,
    ];

    if (dataContext.snapshotText) {
      parts.push(`Verified market snapshot:\n${dataContext.snapshotText}`);
    }

    parts.push(
      `Output language: ${this.toLanguageInstruction(lang)}`,
      'Use only the verified market snapshot for facts and numbers.',
      'Return a compact quick-answer in Markdown using this exact structure:',
      ...template,
      'Assume this is a fast follow-up, not a report request.',
    );

    return parts.join('\n');
  }

  private async resolveIntentState(
    message: string,
    fallbackTimeWindow: '24h' | '7d' | '30d',
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
    fallbackTimeWindow: '24h' | '7d' | '30d',
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

    const assetContext = await this.resolveAssetContext(
      message,
      conversation,
      intentState,
    );
    if (assetContext.kind === 'resolved') {
      const [market, technical] = await Promise.all([
        this.market.fetchPrice(assetContext.identity),
        this.technical.fetchSnapshot(assetContext.identity, timeWindow),
      ]);

      return {
        snapshotText: this.buildResolvedSnapshot(
          assetContext.identity,
          market,
          technical,
          timeWindow,
        ),
        resolvedIdentity: assetContext.identity,
        timeWindow,
        goal,
        scope,
        needsClarification: intentState.needsClarification,
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
    };
  }

  private resolveTimeWindow(
    fallbackTimeWindow: '24h' | '7d' | '30d',
    conversation: InstantConversationState | null,
    intentState: InstantIntentState,
  ): '24h' | '7d' | '30d' {
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

  private outputTemplate(lang: RequestLang): string[] {
    if (lang === 'en') {
      return [
        '1. `**Quick take:** <one short answer>`',
        '2. `- Why:` with 2 to 3 short bullets total',
        '3. `- Action:` with 1 short actionable line',
        '4. `- Risk:` with 1 short line',
      ];
    }

    return [
      '1. `**快速结论：**<一句话结论>`',
      '2. `- 原因：` followed by 2 to 3 short bullets total in Chinese',
      '3. `- 动作：` with 1 short actionable line in Chinese',
      '4. `- 风险：` with 1 short line in Chinese',
    ];
  }

  private buildResolvedSnapshot(
    identity: AnalyzeIdentity,
    market: PriceSnapshot,
    technical: TechnicalSnapshot,
    timeWindow: '24h' | '7d' | '30d',
  ): string {
    const lines = [
      'Asset resolution: resolved',
      `Symbol: ${identity.symbol}`,
      `Chain: ${identity.chain}`,
      `Token address: ${identity.tokenAddress || 'n/a'}`,
      `Source ID: ${identity.sourceId}`,
      'Market snapshot:',
      `- Price USD: ${this.formatNumber(market.priceUsd)}`,
      `- Change 24h pct: ${this.formatSignedNumber(market.change24hPct)}`,
      `- Change 7d pct: ${this.formatSignedNumber(market.change7dPct)}`,
      `- Volume 24h USD: ${this.formatNumber(market.totalVolume24hUsd)}`,
      `- Market cap USD: ${this.formatNumber(market.marketCapUsd)}`,
      `- ATH USD: ${this.formatNumber(market.athUsd)}`,
      `- ATL USD: ${this.formatNumber(market.atlUsd)}`,
      `- Market as of: ${market.asOf}`,
      `Technical snapshot (${timeWindow} view):`,
      `- RSI14: ${this.formatNumber(technical.rsi.value)}`,
      `- MACD: ${this.formatNumber(technical.macd.macd)}`,
      `- MACD signal line: ${this.formatNumber(technical.macd.signalLine)}`,
      `- MACD histogram: ${this.formatNumber(technical.macd.histogram)}`,
      `- MA7: ${this.formatNumber(technical.ma.ma7)}`,
      `- MA25: ${this.formatNumber(technical.ma.ma25)}`,
      `- MA99: ${this.formatNumber(technical.ma.ma99)}`,
      `- Bollinger upper: ${this.formatNumber(technical.boll.upper)}`,
      `- Bollinger middle: ${this.formatNumber(technical.boll.middle)}`,
      `- Bollinger lower: ${this.formatNumber(technical.boll.lower)}`,
      `- Swing high: ${this.formatNumber(technical.swingHigh)}`,
      `- Swing low: ${this.formatNumber(technical.swingLow)}`,
      `- Technical summary signal: ${technical.summarySignal}`,
      `- Technical as of: ${technical.asOf}`,
      'Support/resistance guidance:',
      '- Prefer Bollinger, MA, swing high, and swing low as candidate levels only when numeric values exist.',
    ];

    return lines.join('\n');
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

import { Injectable } from '@nestjs/common';
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
import { InstantConversationService } from './instant-conversation.service';

type InstantReplyResult = {
  body: string;
  responseId: string | null;
  usedPreviousResponseId: boolean;
  usedLocalFallback: boolean;
  model: string;
};

type InstantDataContext = {
  snapshotText: string | null;
};

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
    timeWindow: '24h' | '7d';
    lang: RequestLang;
  }): Promise<InstantReplyResult> {
    const conversation = this.conversations.get(input.threadId);
    const dataContext = await this.collectDataContext(
      input.message,
      input.timeWindow,
    );
    const primaryPrompt = this.buildPrimaryPrompt(
      input.message,
      input.timeWindow,
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
      });

      return {
        body: result.content,
        responseId: result.meta.responseId ?? null,
        usedPreviousResponseId: Boolean(conversation?.lastResponseId),
        usedLocalFallback: false,
        model: result.meta.model,
      };
    } catch (error) {
      if (!conversation || conversation.turns.length === 0) {
        throw error;
      }

      const replayPrompt = this.buildReplayPrompt(
        this.conversations.buildFallbackTranscript(input.threadId),
        input.message,
        input.timeWindow,
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
      });

      return {
        body: retried.content,
        responseId: retried.meta.responseId ?? null,
        usedPreviousResponseId: false,
        usedLocalFallback: true,
        model: retried.meta.model,
      };
    }
  }

  private buildPrimaryPrompt(
    message: string,
    timeWindow: '24h' | '7d',
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      `User question: ${message}`,
      `Default observation window: ${timeWindow}`,
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
    timeWindow: '24h' | '7d',
    lang: RequestLang,
    dataContext: InstantDataContext,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      'Recent conversation from the same thread is provided below. Keep continuity, but do not repeat background unnecessarily.',
      transcript,
      '',
      `Current user question: ${message}`,
      `Default observation window: ${timeWindow}`,
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

  private async collectDataContext(
    message: string,
    timeWindow: '24h' | '7d',
  ): Promise<InstantDataContext> {
    const resolved = await this.searcher.resolve(message);
    if (resolved.kind === 'resolved') {
      const [market, technical] = await Promise.all([
        this.market.fetchPrice(resolved.identity),
        this.technical.fetchSnapshot(resolved.identity, timeWindow),
      ]);

      return {
        snapshotText: this.buildResolvedSnapshot(
          resolved.identity,
          market,
          technical,
          timeWindow,
        ),
      };
    }

    if (resolved.kind === 'ambiguous') {
      return {
        snapshotText: this.buildAmbiguousSnapshot(resolved.candidates),
      };
    }

    return {
      snapshotText: [
        'Asset resolution: unresolved',
        'No verified asset identity could be resolved from the user message.',
        'Do not provide token-specific prices or indicators without clarification.',
      ].join('\n'),
    };
  }

  private buildResolvedSnapshot(
    identity: AnalyzeIdentity,
    market: PriceSnapshot,
    technical: TechnicalSnapshot,
    timeWindow: '24h' | '7d',
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

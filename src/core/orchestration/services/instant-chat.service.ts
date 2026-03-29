import { Injectable } from '@nestjs/common';
import { LlmRuntimeService } from '../../../modules/workflow/runtime/llm-runtime.service';
import type { RequestLang } from '../orchestration.types';
import { InstantConversationService } from './instant-conversation.service';
import { PriceDataService } from './price-data.service';

type InstantReplyResult = {
  body: string;
  responseId: string | null;
  usedPreviousResponseId: boolean;
  usedLocalFallback: boolean;
  model: string;
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
    '   - Do NOT invent prices or indicators',
    '   - If data is missing, say what specific data is needed',
    '   - Do NOT make guaranteed-return claims',
    '   - Keep risk notes to one sentence',
  ].join('\n');

  constructor(
    private readonly llm: LlmRuntimeService,
    private readonly conversations: InstantConversationService,
    private readonly priceData: PriceDataService,
  ) {}

  async reply(input: {
    threadId: string;
    requestId: string;
    message: string;
    timeWindow: '24h' | '7d';
    lang: RequestLang;
  }): Promise<InstantReplyResult> {
    const conversation = this.conversations.get(input.threadId);
    const priceData = await this.extractPriceData(input.message);
    const primaryPrompt = this.buildPrimaryPrompt(
      input.message,
      input.timeWindow,
      input.lang,
      priceData,
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
        priceData,
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
    priceData: string | null,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      `User question: ${message}`,
      `Default observation window: ${timeWindow}`,
    ];

    if (priceData) {
      parts.push(`Real-time market data:\n${priceData}`);
    }

    parts.push(
      `Output language: ${this.toLanguageInstruction(lang)}`,
      '',
      'IMPORTANT: When you have real-time market data, you MUST:',
      '- Include the exact price, 24h change, and key levels',
      '- Mention support/resistance levels with specific prices',
      '- Reference RSI or other indicators if relevant',
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
    priceData: string | null,
  ): string {
    const template = this.outputTemplate(lang);
    const parts = [
      'Recent conversation from the same thread is provided below. Keep continuity, but do not repeat background unnecessarily.',
      transcript,
      '',
      `Current user question: ${message}`,
      `Default observation window: ${timeWindow}`,
    ];

    if (priceData) {
      parts.push(`Real-time market data:\n${priceData}`);
    }

    parts.push(
      `Output language: ${this.toLanguageInstruction(lang)}`,
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

  private async extractPriceData(message: string): Promise<string | null> {
    const match = message.match(/\b([A-Z]{2,10})\b/);
    if (!match) return null;

    const symbol = match[1];
    const data = await this.priceData.getPrice(symbol);
    if (!data) return null;

    return [
      `${data.symbol}: $${data.price.toLocaleString()}`,
      `24h Change: ${data.change24h > 0 ? '+' : ''}${data.change24h.toFixed(2)}%`,
      `24h Range: $${data.low24h.toLocaleString()} - $${data.high24h.toLocaleString()}`,
    ].join('\n');
  }
}

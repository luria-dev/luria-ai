import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

type GenerateStructuredInput<T> = {
  nodeName: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  fallback: () => T;
};

@Injectable()
export class LlmRuntimeService {
  private readonly logger = new Logger(LlmRuntimeService.name);
  private readonly mode = (process.env.LURIA_LLM_MODE ?? 'mock').toLowerCase();
  private readonly model = process.env.LURIA_LLM_MODEL ?? 'gpt-4.1-mini';

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    if (this.mode !== 'openai') {
      return input.fallback();
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        `[${input.nodeName}] OPENAI_API_KEY is missing, fallback to mock.`,
      );
      return input.fallback();
    }

    try {
      const first = await this.callOpenAi(
        apiKey,
        input.systemPrompt,
        input.userPrompt,
      );
      const firstParsed = this.parseStructured(first, input.schema);
      if (firstParsed.success) {
        return firstParsed.data;
      }

      this.logger.warn(
        `[${input.nodeName}] First pass schema invalid, retrying with correction prompt.`,
      );
      const second = await this.callOpenAi(
        apiKey,
        `${input.systemPrompt}\nYour previous output failed schema validation. Return corrected JSON only.`,
        `Fix the JSON to satisfy the schema.\nPrevious output:\n${this.stringifyForRetry(first)}`,
      );
      const secondParsed = this.parseStructured(second, input.schema);
      if (secondParsed.success) {
        return secondParsed.data;
      }

      this.logger.warn(
        `[${input.nodeName}] Retry schema still invalid, fallback to mock.`,
      );
      return input.fallback();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${input.nodeName}] LLM node failed: ${message}`);
      return input.fallback();
    }
  }

  private async callOpenAi(
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `OpenAI request failed: ${response.status} ${response.statusText} ${errText}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error('Empty LLM output.');
    }

    return content;
  }

  private parseStructured<T>(
    raw: string,
    schema: z.ZodType<T>,
  ): { success: true; data: T } | { success: false } {
    const candidates = this.getJsonCandidates(raw);
    for (const candidate of candidates) {
      try {
        const parsedRaw = JSON.parse(candidate) as unknown;
        const parsed = schema.safeParse(parsedRaw);
        if (parsed.success) {
          return { success: true, data: parsed.data };
        }
      } catch {
        // keep trying next candidate
      }
    }
    return { success: false };
  }

  private getJsonCandidates(raw: string): string[] {
    const trimmed = raw.trim();
    const candidates: string[] = [trimmed];

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    return [...new Set(candidates)];
  }

  private stringifyForRetry(raw: string): string {
    if (raw.length <= 4000) {
      return raw;
    }
    return `${raw.slice(0, 4000)}...[truncated]`;
  }
}

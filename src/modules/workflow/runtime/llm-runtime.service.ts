import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

type GenerateStructuredInput<T> = {
  nodeName: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  fallback: () => T;
  correctionGuidance?: string[];
  maxTokens?: number;
  timeoutMs?: number;
};

type GenerateTextInput = {
  nodeName: string;
  systemPrompt: string;
  userPrompt: string;
  model?: SupportedChatModel;
  previousResponseId?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export type StructuredGenerationMeta = {
  llmStatus: 'success' | 'retry_success' | 'fallback';
  attempts: number;
  schemaCorrection: boolean;
  failureReason?: string;
  model: string;
};

type StructuredGenerationResult<T> = {
  data: T;
  meta: StructuredGenerationMeta;
};

export type TextGenerationMeta = {
  attempts: number;
  model: string;
  responseId?: string;
};

export type TextGenerationResult = {
  content: string;
  meta: TextGenerationMeta;
};

type ParseStructuredSuccess<T> = {
  success: true;
  data: T;
};

type ParseStructuredFailure = {
  success: false;
  issues: string[];
};

type ResponsesPayload = {
  id?: string;
  model?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  output?: Array<{
    type?: string;
    role?: string;
    status?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

const SUPPORTED_CHAT_MODELS = ['gpt-5.4', 'qwen3-max'] as const;
type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
type SupportedLlmProvider = 'openai' | 'dashscope';
type ResolvedRequestOptions = {
  provider: SupportedLlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  logicalModel: SupportedChatModel;
  maxTokens: number;
  timeoutMs: number;
};

class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
  }
}

@Injectable()
export class LlmRuntimeService {
  private readonly logger = new Logger(LlmRuntimeService.name);
  private readonly retryAttempts = this.readNumberEnv(
    'LURIA_LLM_RETRY_ATTEMPTS',
    3,
  );
  private readonly retryBackoffMs = this.readNumberEnv(
    'LURIA_LLM_RETRY_BACKOFF_MS',
    800,
  );
  private readonly mode = (process.env.LURIA_LLM_MODE ?? 'mock').toLowerCase();
  private readonly model = this.resolveModel(
    process.env.LURIA_LLM_MODEL ?? 'gpt-5.4',
  );
  private readonly intentModel = this.resolveOptionalModel(
    process.env.LURIA_INTENT_LLM_MODEL,
  );
  private readonly analysisModel = this.resolveOptionalModel(
    process.env.LURIA_ANALYSIS_LLM_MODEL,
  );
  private readonly reportModel = this.resolveOptionalModel(
    process.env.LURIA_REPORT_LLM_MODEL,
  );
  private readonly temperature = this.readNumberEnv('LURIA_LLM_TEMPERATURE', 0);
  private readonly maxTokens = this.readNumberEnv('LURIA_LLM_MAX_TOKENS', 1500);
  private readonly timeoutMs = this.readNumberEnv('LURIA_LLM_TIMEOUT_MS', 30000);
  private readonly analysisMaxTokens = this.readNumberEnv(
    'LURIA_ANALYSIS_LLM_MAX_TOKENS',
    2600,
  );
  private readonly analysisTimeoutMs = this.readNumberEnv(
    'LURIA_ANALYSIS_LLM_TIMEOUT_MS',
    90000,
  );
  private readonly reportMaxTokens = this.readNumberEnv(
    'LURIA_REPORT_LLM_MAX_TOKENS',
    3000,
  );
  private readonly reportTimeoutMs = this.readNumberEnv(
    'LURIA_REPORT_LLM_TIMEOUT_MS',
    90000,
  );

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<T> {
    const result = await this.generateStructuredWithMeta(input);
    return result.data;
  }

  async generateText(input: GenerateTextInput): Promise<TextGenerationResult> {
    if (this.mode !== 'openai') {
      throw new Error(`llm_mode_${this.mode}`);
    }

    const requestOptions = this.resolveTextRequestOptions(input);
    if (this.shouldLogVerboseNode(input.nodeName)) {
      this.logger.log(
        `[${input.nodeName}] Request config provider=${requestOptions.provider} model=${requestOptions.model} logicalModel=${requestOptions.logicalModel} systemLen=${input.systemPrompt.length} userLen=${input.userPrompt.length} maxTokens=${requestOptions.maxTokens} timeoutMs=${requestOptions.timeoutMs} previousResponseId=${input.previousResponseId ?? 'none'}`,
      );
    }

    const result = await this.callResponsesWithRetry(
      input.nodeName,
      input.systemPrompt,
      input.userPrompt,
      requestOptions,
      input.previousResponseId
        ? {
            previous_response_id: input.previousResponseId,
          }
        : undefined,
    );

    return {
      content: result.content,
      meta: {
        attempts: result.attempts,
        model: requestOptions.model,
        responseId: result.responseId,
      },
    };
  }

  async generateStructuredWithMeta<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<StructuredGenerationResult<T>> {
    if (this.mode !== 'openai') {
      return {
        data: input.fallback(),
        meta: {
          llmStatus: 'fallback',
          attempts: 0,
          schemaCorrection: false,
          failureReason: `llm_mode_${this.mode}`,
          model: this.resolveModelForNode(input.nodeName),
        },
      };
    }

    try {
      let totalAttempts = 0;
      let schemaCorrection = false;
      const requestOptions = this.resolveRequestOptions(input);
      const activeModel = requestOptions.model;

      if (this.shouldLogVerboseNode(input.nodeName)) {
        this.logger.log(
          `[${input.nodeName}] Request config provider=${requestOptions.provider} model=${activeModel} logicalModel=${requestOptions.logicalModel} systemLen=${input.systemPrompt.length} userLen=${input.userPrompt.length} maxTokens=${requestOptions.maxTokens} timeoutMs=${requestOptions.timeoutMs}`,
        );
      }

      const first = await this.callResponsesWithRetry(
        input.nodeName,
        input.systemPrompt,
        input.userPrompt,
        requestOptions,
      );
      totalAttempts += first.attempts;
      const firstParsed = this.parseStructured(first.content, input.schema);
      if (firstParsed.success) {
        return {
          data: firstParsed.data,
          meta: {
            llmStatus: totalAttempts > 1 ? 'retry_success' : 'success',
            attempts: totalAttempts,
            schemaCorrection,
            model: activeModel,
          },
        };
      }

      schemaCorrection = true;
      this.logger.warn(
        `[${input.nodeName}] First pass schema invalid, retrying with correction prompt. Issues: ${firstParsed.issues.join(' | ')}`,
      );
      const second = await this.callResponsesWithRetry(
        input.nodeName,
        [
          input.systemPrompt,
          'Your previous output failed schema validation.',
          'Return corrected JSON only.',
          ...(input.correctionGuidance ?? []),
        ].join('\n'),
        [
          'Fix the JSON to satisfy the schema.',
          'Validation errors:',
          ...firstParsed.issues.map((issue) => `- ${issue}`),
          'Previous output:',
          this.stringifyForRetry(first.content),
        ].join('\n'),
        requestOptions,
      );
      totalAttempts += second.attempts;
      const secondParsed = this.parseStructured(second.content, input.schema);
      if (secondParsed.success) {
        return {
          data: secondParsed.data,
          meta: {
            llmStatus: 'retry_success',
            attempts: totalAttempts,
            schemaCorrection,
            model: activeModel,
          },
        };
      }

      this.logger.warn(
        `[${input.nodeName}] Retry schema still invalid, fallback to mock. Issues: ${secondParsed.issues.join(' | ')}`,
      );
      return {
        data: input.fallback(),
        meta: {
          llmStatus: 'fallback',
          attempts: totalAttempts,
          schemaCorrection,
          failureReason: `schema_invalid: ${secondParsed.issues.join(' | ')}`,
          model: activeModel,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${input.nodeName}] LLM node failed: ${message}`);
      return {
        data: input.fallback(),
        meta: {
          llmStatus: 'fallback',
          attempts: error instanceof LlmRequestError ? error.attempts : 1,
          schemaCorrection: false,
          failureReason: message,
          model: this.resolveModelForNode(input.nodeName),
        },
      };
    }
  }

  private async callResponsesWithRetry(
    nodeName: string,
    systemPrompt: string,
    userPrompt: string,
    requestOptions: ResolvedRequestOptions,
    extraBody?: Record<string, unknown>,
  ): Promise<{ content: string; responseId?: string; attempts: number }> {
    const totalAttempts = Math.max(1, this.retryAttempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        const result = await this.callResponses(
          nodeName,
          systemPrompt,
          userPrompt,
          requestOptions,
          extraBody,
        );
        return { ...result, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryLlmError(error) || attempt >= totalAttempts) {
          const message = error instanceof Error ? error.message : String(error);
          throw new LlmRequestError(message, attempt);
        }

        const delayMs = this.retryBackoffMs * attempt;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[${nodeName}] Transient LLM failure on attempt ${attempt}/${totalAttempts}: ${message}. Retrying in ${delayMs}ms.`,
        );
        await this.sleep(delayMs);
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new LlmRequestError(message, totalAttempts);
  }

  private async callResponses(
    nodeName: string,
    systemPrompt: string,
    userPrompt: string,
    requestOptions: ResolvedRequestOptions,
    extraBody?: Record<string, unknown>,
  ): Promise<{ content: string; responseId?: string }> {
    const endpoint = `${requestOptions.baseUrl}/responses`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestOptions.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${requestOptions.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: requestOptions.model,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_output_tokens: requestOptions.maxTokens,
          temperature: this.temperature,
          ...(extraBody ?? {}),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `LLM API request failed: ${response.status} ${response.statusText} ${errText}`,
        );
      }

      const payload = (await response.json()) as ResponsesPayload;
      const content = this.extractResponseText(payload);

      if (this.shouldLogVerboseNode(nodeName)) {
        this.logger.log(
          [
            `[${nodeName}] Response meta`,
            `id=${payload.id ?? 'unknown'}`,
            `model=${payload.model ?? requestOptions.model}`,
            `status=${payload.output?.[0]?.status ?? 'unknown'}`,
            `promptTokens=${payload.usage?.input_tokens ?? 'n/a'}`,
            `completionTokens=${payload.usage?.output_tokens ?? 'n/a'}`,
            `totalTokens=${payload.usage?.total_tokens ?? 'n/a'}`,
            `contentLength=${content.length}`,
            `hasOutput=${Boolean(payload.output?.length)}`,
          ].join(' | '),
        );
      }

      if (content.trim().length === 0) {
        if (this.shouldLogVerboseNode(nodeName)) {
          this.logger.warn(
            [
              `[${nodeName}] Empty content details`,
              `outputLength=${payload.output?.length ?? 0}`,
              `hasOutputText=${Boolean(payload.output_text)}`,
              `errorCode=${payload.error?.code ?? 'none'}`,
            ].join(' | '),
          );
        }
        throw new Error('Empty LLM output.');
      }

      return {
        content,
        responseId: payload.id,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private shouldRetryLlmError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes('fetch failed') ||
      normalized.includes('network') ||
      normalized.includes('timed out') ||
      normalized.includes('timeout') ||
      normalized.includes('operation was aborted') ||
      normalized.includes('was aborted') ||
      normalized.includes('aborted') ||
      normalized.includes('aborterror') ||
      normalized.includes('429') ||
      normalized.includes('500') ||
      normalized.includes('502') ||
      normalized.includes('503') ||
      normalized.includes('504')
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseStructured<T>(
    raw: string,
    schema: z.ZodType<T>,
  ): ParseStructuredSuccess<T> | ParseStructuredFailure {
    const candidates = this.getJsonCandidates(raw);
    const issues: string[] = [];
    let jsonParsed = false;

    for (const candidate of candidates) {
      try {
        const parsedRaw = JSON.parse(candidate) as unknown;
        jsonParsed = true;
        const parsed = schema.safeParse(parsedRaw);
        if (parsed.success) {
          return { success: true, data: parsed.data };
        }
        issues.push(...this.formatZodIssues(parsed.error));
      } catch {
        // keep trying next candidate
      }
    }

    if (!jsonParsed) {
      issues.push('Response did not contain valid JSON.');
    }

    return {
      success: false,
      issues:
        issues.length > 0
          ? [...new Set(issues)].slice(0, 12)
          : ['Response did not satisfy the expected schema.'],
    };
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

  private extractResponseText(payload: ResponsesPayload): string {
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
      return payload.output_text.trim();
    }

    for (const item of payload.output ?? []) {
      for (const part of item.content ?? []) {
        if (
          (part.type === 'output_text' || part.type === 'text') &&
          typeof part.text === 'string' &&
          part.text.trim()
        ) {
          return part.text.trim();
        }
      }
    }

    return '';
  }

  private resolveRequestOptions(
    input: GenerateStructuredInput<unknown>,
  ): ResolvedRequestOptions {
    const logicalModel = this.resolveModelForNode(input.nodeName);
    let defaultMaxTokens = this.maxTokens;
    let defaultTimeoutMs = this.timeoutMs;

    if (input.nodeName === 'analysis') {
      defaultMaxTokens = this.analysisMaxTokens;
      defaultTimeoutMs = this.analysisTimeoutMs;
    } else if (input.nodeName === 'report') {
      defaultMaxTokens = this.reportMaxTokens;
      defaultTimeoutMs = this.reportTimeoutMs;
    }

    return this.resolveProviderRequestOptions(
      logicalModel,
      input.maxTokens ?? defaultMaxTokens,
      input.timeoutMs ?? defaultTimeoutMs,
    );
  }

  private resolveTextRequestOptions(
    input: GenerateTextInput,
  ): ResolvedRequestOptions {
    return this.resolveProviderRequestOptions(
      input.model ?? this.resolveModelForNode(input.nodeName),
      input.maxTokens ?? this.maxTokens,
      input.timeoutMs ?? this.timeoutMs,
    );
  }

  private shouldLogVerboseNode(nodeName: string): boolean {
    return nodeName === 'analysis' || nodeName === 'report';
  }

  private formatZodIssues(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    });
  }

  private resolveModel(raw: string): SupportedChatModel {
    const model = raw.trim();
    if ((SUPPORTED_CHAT_MODELS as readonly string[]).includes(model)) {
      return model as SupportedChatModel;
    }

    this.logger.warn(
      `Unsupported LLM model "${model}", fallback to "gpt-5.4". Supported models: ${SUPPORTED_CHAT_MODELS.join(', ')}.`,
    );
    return 'gpt-5.4';
  }

  private resolveOptionalModel(
    raw: string | undefined,
  ): SupportedChatModel | undefined {
    if (!raw?.trim()) {
      return undefined;
    }
    return this.resolveModel(raw);
  }

  private resolveModelForNode(nodeName: string): SupportedChatModel {
    if (nodeName === 'intent' && this.intentModel) {
      return this.intentModel;
    }
    if (nodeName === 'analysis' && this.analysisModel) {
      return this.analysisModel;
    }
    if (nodeName === 'report' && this.reportModel) {
      return this.reportModel;
    }
    return this.model;
  }

  private resolveProviderRequestOptions(
    logicalModel: SupportedChatModel,
    maxTokens: number,
    timeoutMs: number,
  ): ResolvedRequestOptions {
    if (logicalModel === 'gpt-5.4') {
      const apiKey =
        process.env.OPENAI_API_KEY?.trim() ??
        process.env.LURIA_OPENAI_API_KEY?.trim() ??
        process.env.LURIA_LLM_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('missing_openai_api_key');
      }
      return {
        provider: 'openai',
        apiKey,
        baseUrl: this.normalizeBaseUrl(
          process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        ),
        model: logicalModel,
        logicalModel,
        maxTokens,
        timeoutMs,
      };
    }

    const apiKey =
      process.env.DASHSCOPE_API_KEY?.trim() ??
      process.env.LURIA_DASHSCOPE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('missing_dashscope_api_key');
    }
    return {
      provider: 'dashscope',
      apiKey,
      baseUrl: this.normalizeBaseUrl(
        process.env.DASHSCOPE_BASE_URL ??
          'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
      ),
      model: logicalModel,
      logicalModel,
      maxTokens,
      timeoutMs,
    };
  }

  private normalizeBaseUrl(raw: string): string {
    const value = raw.trim();
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  private readNumberEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw?.trim()) {
      return fallback;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    this.logger.warn(
      `Invalid numeric env ${key}="${raw}", fallback to ${fallback}.`,
    );
    return fallback;
  }
}

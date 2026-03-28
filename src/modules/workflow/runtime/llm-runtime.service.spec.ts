import { z } from 'zod';
import { LlmRuntimeService } from './llm-runtime.service';

describe('LlmRuntimeService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LURIA_LLM_MODE: 'openai',
      LURIA_LLM_MODEL: 'gpt-5.4',
      LURIA_REPORT_LLM_MODEL: 'gpt-5.4',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      LURIA_LLM_RETRY_ATTEMPTS: '2',
      LURIA_LLM_RETRY_BACKOFF_MS: '0',
      LURIA_LLM_TIMEOUT_MS: '1000',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries transient aborted errors instead of falling back immediately', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('This operation was aborted'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_test',
            model: 'gpt-5.4',
            output_text: '{"ok":true}',
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    global.fetch = fetchMock;

    const service = new LlmRuntimeService();
    const result = await service.generateStructuredWithMeta({
      nodeName: 'report',
      systemPrompt: 'system',
      userPrompt: 'user',
      schema: z.object({ ok: z.boolean() }),
      fallback: () => ({ ok: false }),
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.meta.llmStatus).toBe('retry_success');
    expect(result.meta.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

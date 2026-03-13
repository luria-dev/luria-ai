import { IntentNodeService } from './intent-node.service';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';

describe('IntentNodeService', () => {
  const runtimeStub: Pick<LlmRuntimeService, 'generateStructured'> = {
    async generateStructured<T>(input: { fallback: () => T }): Promise<T> {
      return input.fallback();
    },
  };

  it('should parse chinese query with risk objective fallback', async () => {
    const service = new IntentNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.parse({
      query: '帮我看下SOL现在风险怎么样，适不适合买入',
      timeWindow: '24h',
      preferredChain: 'solana',
    });

    expect(result.language).toBe('zh');
    expect(result.objective).toBe('risk_check');
    expect(result.focusAreas).toContain('security_risk');
    expect(result.chains).toEqual(['solana']);
  });

  it('should parse english timing query fallback', async () => {
    const service = new IntentNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.parse({
      query: 'Should I enter ETH now based on technical and onchain flow?',
      timeWindow: '7d',
      preferredChain: null,
    });

    expect(result.language).toBe('en');
    expect(result.objective).toBe('timing_decision');
    expect(result.taskType).toBe('single_asset');
    expect(result.focusAreas).toContain('technical_indicators');
    expect(result.timeWindow).toBe('7d');
  });

  it('should mark comparison task for compare-style query with multiple entities', async () => {
    const service = new IntentNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.parse({
      query: 'Aster vs Hyper 谁更值得投资',
      timeWindow: '24h',
      preferredChain: null,
    });

    expect(result.taskType).toBe('comparison');
    expect(result.entities).toEqual(expect.arrayContaining(['ASTER', 'HYPER']));
  });

  it('should reuse memo entities for follow-up query without explicit token', async () => {
    const service = new IntentNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.parse({
      query: '那风险呢？',
      timeWindow: '24h',
      preferredChain: null,
      memo: {
        threadId: 'thread-1',
        lastIntent: {
          userQuery: '帮我看下PEPE短线',
          language: 'zh',
          taskType: 'single_asset',
          objective: 'timing_decision',
          sentimentBias: 'unknown',
          timeWindow: '24h',
          entities: ['PEPE'],
          symbols: ['PEPE'],
          chains: ['ethereum'],
          focusAreas: ['technical_indicators', 'security_risk'],
          constraints: ['hard_risk_controls'],
        },
        lastResolvedTargets: [
          {
            targetKey: 'PEPE',
            identity: {
              symbol: 'PEPE',
              chain: 'ethereum',
              tokenAddress: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
              sourceId: 'coinmarketcap:24478',
            },
          },
        ],
        lastRequestId: 'req-prev',
        updatedAt: new Date().toISOString(),
      },
    });

    expect(result.taskType).toBe('single_asset');
    expect(result.entities).toContain('PEPE');
    expect(result.symbols).toContain('PEPE');
    expect(result.chains).toEqual(['ethereum']);
    expect(result.focusAreas).toContain('security_risk');
  });
});

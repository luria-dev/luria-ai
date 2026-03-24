import { PlanningNodeService } from './planning-node.service';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';

describe('PlanningNodeService', () => {
  const runtimeStub: Pick<LlmRuntimeService, 'generateStructuredWithMeta'> = {
    async generateStructuredWithMeta<T>(input: {
      fallback: () => T;
    }): Promise<{
      data: T;
      meta: {
        llmStatus: 'fallback';
        attempts: 1;
        schemaCorrection: false;
        model: null;
      };
    }> {
      return {
        data: input.fallback(),
        meta: {
          llmStatus: 'fallback',
          attempts: 1,
          schemaCorrection: false,
          model: null,
        },
      };
    },
  };

  const baseIntent: IntentOutput = {
    userQuery: 'Analyze SOL trend and risk.',
    language: 'en',
    interactionType: 'new_query',
    taskType: 'single_asset',
    outputGoal: 'strategy',
    needsClarification: false,
    objective: 'timing_decision',
    sentimentBias: 'unknown',
    timeWindow: '24h',
    entities: ['SOL'],
    entityMentions: ['SOL'],
    symbols: ['SOL'],
    chains: ['solana'],
    focusAreas: ['technical_indicators', 'onchain_flow', 'security_risk'],
    constraints: ['hard_risk_controls'],
  };

  it('should include mandatory requirements in fallback plan', async () => {
    const service = new PlanningNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.build({
      intent: baseIntent,
      identity: {
        symbol: 'SOL',
        chain: 'solana',
        tokenAddress: 'So11111111111111111111111111111111111111112',
        sourceId: 'coinmarketcap:5426',
      },
    });

    const dataTypes = result.requirements.map((item) => item.dataType);
    expect(dataTypes).toContain('price');
    expect(dataTypes).toContain('security');
    expect(dataTypes).toContain('liquidity');
    expect(dataTypes).toContain('technical');
    expect(dataTypes).toContain('onchain');
    expect(dataTypes).toContain('sentiment');
    expect(result.analysisQuestions.length).toBeGreaterThan(0);
  });

  it('should keep sentiment required even for tokenomics-focused fallback plans', async () => {
    const service = new PlanningNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.build({
      intent: {
        ...baseIntent,
        objective: 'market_overview',
        focusAreas: ['price_action', 'tokenomics'],
      },
      identity: {
        symbol: 'BTC',
        chain: 'bitcoin',
        tokenAddress: '',
        sourceId: 'coingecko:bitcoin',
      },
    });

    const dataTypes = result.requirements.map((item) => item.dataType);
    expect(dataTypes).toContain('tokenomics');
    expect(dataTypes).toContain('sentiment');
  });
});

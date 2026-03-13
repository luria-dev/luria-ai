import { PlanningNodeService } from './planning-node.service';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';

describe('PlanningNodeService', () => {
  const runtimeStub: Pick<LlmRuntimeService, 'generateStructured'> = {
    async generateStructured<T>(input: { fallback: () => T }): Promise<T> {
      return input.fallback();
    },
  };

  const baseIntent: IntentOutput = {
    userQuery: 'Analyze SOL trend and risk.',
    language: 'en',
    taskType: 'single_asset',
    objective: 'timing_decision',
    sentimentBias: 'unknown',
    timeWindow: '24h',
    entities: ['SOL'],
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
    expect(result.analysisQuestions.length).toBeGreaterThan(0);
  });
});

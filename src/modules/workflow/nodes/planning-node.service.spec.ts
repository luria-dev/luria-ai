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

  it('should build an action-oriented fallback plan for execution questions', async () => {
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
    expect(result.taskDisposition).toBe('analyze');
    expect(result.responseMode).toBe('act');
    expect(dataTypes).toContain('price');
    expect(dataTypes).toContain('security');
    expect(dataTypes).toContain('technical');
    expect(dataTypes).toContain('onchain');
    expect(result.openResearch.enabled).toBe(true);
    expect(result.analysisQuestions.length).toBeGreaterThan(0);
  });

  it('should keep explanatory tokenomics questions in explain mode', async () => {
    const service = new PlanningNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.build({
      intent: {
        ...baseIntent,
        userQuery: 'Explain BTC tokenomics and how the current narrative is evolving.',
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
    expect(result.taskDisposition).toBe('analyze');
    expect(result.responseMode).toBe('explain');
    expect(result.subTasks.length).toBeGreaterThan(0);
    expect(dataTypes).toContain('news');
    expect(dataTypes).toContain('sentiment');
  });

  it('should classify investment-value questions as assess mode', async () => {
    const service = new PlanningNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.build({
      intent: {
        ...baseIntent,
        userQuery: 'Is BTC still worth investing in and what is the biggest risk?',
        objective: 'market_overview',
        focusAreas: ['price_action', 'project_fundamentals'],
      },
      identity: {
        symbol: 'BTC',
        chain: 'bitcoin',
        tokenAddress: '',
        sourceId: 'coingecko:bitcoin',
      },
    });

    expect(result.taskDisposition).toBe('analyze');
    expect(result.responseMode).toBe('assess');
    expect(
      result.analysisQuestions.some((question) =>
        question.toLowerCase().includes('investment case'),
      ),
    ).toBe(true);
    expect(result.openResearch.enabled).toBe(true);
    expect(result.openResearch.depth).toBe('heavy');
  });

  it('should keep relationship-analysis questions in explain mode with relationship sub-questions', async () => {
    const service = new PlanningNodeService(runtimeStub as LlmRuntimeService);
    const result = await service.build({
      intent: {
        ...baseIntent,
        userQuery: 'BONK和SOL生态之间是什么关系？',
        taskType: 'multi_asset',
        outputGoal: 'analysis',
        objective: 'relationship_analysis',
        entities: ['BONK', 'SOL'],
        entityMentions: ['BONK', 'SOL'],
        symbols: ['BONK', 'SOL'],
        focusAreas: ['project_fundamentals', 'news_events'],
      },
      identity: {
        symbol: 'BONK',
        chain: 'solana',
        tokenAddress: '',
        sourceId: 'coingecko:bonk',
      },
    });

    expect(result.responseMode).toBe('explain');
    expect(
      result.subTasks.some((task) => task.includes('relationship')),
    ).toBe(true);
    expect(result.openResearch.enabled).toBe(true);
    expect(result.openResearch.topics.join(' ')).toContain('relationship');
  });
});

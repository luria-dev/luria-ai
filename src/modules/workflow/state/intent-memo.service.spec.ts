import { IntentMemoService } from './intent-memo.service';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';

const baseIntent: IntentOutput = {
  userQuery: '帮我看下 PEPE',
  language: 'zh',
  interactionType: 'new_query',
  taskType: 'single_asset',
  outputGoal: 'analysis',
  needsClarification: false,
  objective: 'market_overview',
  sentimentBias: 'unknown',
  timeWindow: '24h',
  entities: ['PEPE'],
  entityMentions: ['PEPE'],
  symbols: ['PEPE'],
  chains: ['ethereum'],
  focusAreas: ['price_action'],
  constraints: ['hard_risk_controls'],
};

describe('IntentMemoService', () => {
  it('should save and get memo by normalized thread id', () => {
    const service = new IntentMemoService();
    service.save({
      threadId: ' thread-1 ',
      intent: baseIntent,
      resolvedTargets: [
        {
          targetKey: 'PEPE',
          identity: {
            symbol: 'PEPE',
            chain: 'ethereum',
            tokenAddress: '0x-pepe',
            sourceId: 'coinmarketcap:24478',
          },
        },
      ],
      requestId: 'req-1',
    });

    const memo = service.get('thread-1');
    expect(memo).not.toBeNull();
    expect(memo?.threadId).toBe('thread-1');
    expect(memo?.lastIntent.entities).toEqual(['PEPE']);
    expect(memo?.lastResolvedTargets[0]?.identity.symbol).toBe('PEPE');
  });

  it('should return null for empty thread id', () => {
    const service = new IntentMemoService();
    expect(service.get('   ')).toBeNull();
  });
});

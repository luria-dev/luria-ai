import { SearcherService } from './searcher.service';
import { MarketService } from '../market/market.service';
import type { AnalyzeCandidate } from '../../../data/contracts/analyze-contracts';

const makeCandidate = (symbol: string, chain: string): AnalyzeCandidate => ({
  candidateId: `cand-${chain}-${symbol.toLowerCase()}-token`,
  tokenName: symbol,
  symbol,
  chain,
  tokenAddress: `${symbol.toLowerCase()}-${chain}-token`,
  quoteToken: 'OTHER',
  sourceId: 'coinmarketcap:1',
});

describe('SearcherService', () => {
  it('should split targets from intent entities when taskType is comparison', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        if (query === 'ASTER') {
          return [makeCandidate('ASTER', 'base')];
        }
        if (query === 'HYPER') {
          return [makeCandidate('HYPER', 'arbitrum')];
        }
        return [];
      },
    };

    const service = new SearcherService(marketStub as MarketService);
    const result = await service.resolveMany(
      'Aster vs Hyper 谁更值得投资',
      null,
      {
        taskType: 'comparison',
        entities: ['Aster', 'Hyper'],
      },
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.targetKey)).toEqual(['ASTER', 'HYPER']);
    expect(result[0].result.kind).toBe('resolved');
    expect(result[1].result.kind).toBe('resolved');
  });

  it('should keep single PRIMARY target when taskType is single_asset', async () => {
    const calls: string[] = [];
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        calls.push(query);
        return [makeCandidate('ASTER', 'base')];
      },
    };

    const service = new SearcherService(marketStub as MarketService);
    const result = await service.resolveMany(
      'Aster vs Hyper 谁更值得投资',
      null,
      {
        taskType: 'single_asset',
        entities: ['Aster', 'Hyper'],
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].targetKey).toBe('PRIMARY');
    expect(calls).toEqual(['Aster vs Hyper 谁更值得投资']);
  });
});

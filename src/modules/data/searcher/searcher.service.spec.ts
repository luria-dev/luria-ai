import { SearcherService } from './searcher.service';
import { MarketService } from '../market/market.service';
import type { AnalyzeCandidate } from '../../../data/contracts/analyze-contracts';
import { SearchCacheService } from '../cache/search-cache.service';

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
  const searchCacheStub: Pick<
    SearchCacheService,
    'findIdentity' | 'getCandidates' | 'storeCandidates'
  > = {
    async findIdentity() {
      return null;
    },
    async getCandidates() {
      return null;
    },
    async storeCandidates() {
      return;
    },
  };

  it('should split targets from intent entities when taskType is comparison', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        if (query === 'ASTER' || query === 'Aster') {
          return [makeCandidate('ASTER', 'base')];
        }
        if (query === 'HYPER' || query === 'Hyper') {
          return [makeCandidate('HYPER', 'arbitrum')];
        }
        return [];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany(
      'Aster vs Hyper 谁更值得投资',
      null,
      {
        taskType: 'comparison',
        entities: ['Aster', 'Hyper'],
        entityMentions: ['Aster', 'Hyper'],
        chains: [],
      },
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.targetKey)).toEqual(['ASTER', 'HYPER']);
    expect(result[0].result.kind).toBe('resolved');
    expect(result[1].result.kind).toBe('resolved');
  });

  it('should use intent entities for single_asset mode', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        expect(query).toBe('Aster');
        return [makeCandidate('ASTER', 'base')];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany('Aster 这个代币怎么样', null, {
      taskType: 'single_asset',
      entities: ['Aster'],
      entityMentions: ['Aster'],
      chains: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].targetKey).toBe('PRIMARY');
    expect(result[0].result.kind).toBe('resolved');
  });

  it('should split multiple entities even when taskType is single_asset', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        if (query === 'BTC') {
          return [makeCandidate('BTC', 'bitcoin')];
        }
        if (query === 'ETH') {
          return [makeCandidate('ETH', 'ethereum')];
        }
        return [];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany(
      '请分别分析 BTC 和 ETH 的投资价值，不要比较，只分别给出结论',
      null,
      {
        taskType: 'single_asset',
        entities: ['BTC', 'ETH'],
        entityMentions: ['BTC', 'ETH'],
        chains: [],
      },
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.targetKey)).toEqual(['BTC', 'ETH']);
    expect(result.every((item) => item.result.kind === 'resolved')).toBe(true);
  });

  it('should resolve comparison targets with per-target chain hints', async () => {
    const seen: Array<{ query: string; preferredChain?: string | null }> = [];
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(
        query: string,
        preferredChain?: string | null,
      ): Promise<AnalyzeCandidate[]> {
        seen.push({ query, preferredChain });
        if (query === 'BITCOIN' && preferredChain === 'bitcoin') {
          return [makeCandidate('BTC', 'bitcoin')];
        }
        if (query === 'ETHEREUM' && preferredChain === 'ethereum') {
          return [makeCandidate('ETH', 'ethereum')];
        }
        return [];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany(
      '对比 BTC 和 ETH 接下来24小时谁更强',
      null,
      {
        taskType: 'comparison',
        entities: ['Bitcoin', 'Ethereum'],
        entityMentions: ['BTC', 'ETH'],
        chains: ['bitcoin', 'ethereum'],
      },
    );
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.result.kind === 'resolved')).toBe(true);
  });

  it('should fallback to ambiguous registry candidates for fuzzy query', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(): Promise<AnalyzeCandidate[]> {
        return [];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany(
      '分析 neir 接下来24小时走势',
      null,
      {
        taskType: 'single_asset',
        entities: ['NEIR'],
        entityMentions: ['neir'],
        chains: [],
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].result.kind).toBe('ambiguous');
    if (result[0].result.kind === 'ambiguous') {
      expect(result[0].result.candidates.map((item) => item.symbol)).toEqual(
        expect.arrayContaining(['NEIRO', 'NEIROCTO']),
      );
    }
  });

  it('should fallback to raw query when no entities in intent', async () => {
    const marketStub: Pick<MarketService, 'searchCandidates'> = {
      async searchCandidates(query: string): Promise<AnalyzeCandidate[]> {
        expect(query).toBe('帮我查询 uni 的行情'); // Should fallback to raw query
        return [makeCandidate('UNI', 'ethereum')];
      },
    };

    const service = new SearcherService(
      marketStub as MarketService,
      searchCacheStub as SearchCacheService,
    );
    const result = await service.resolveMany('帮我查询 uni 的行情', null, {
      taskType: 'single_asset',
      entities: [], // Empty entities
      entityMentions: [],
      chains: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].targetKey).toBe('PRIMARY');
  });
});

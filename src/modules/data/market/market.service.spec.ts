import { MarketService } from './market.service';

describe('MarketService.fetchPrice', () => {
  const identity = {
    symbol: 'PEPE',
    chain: 'ethereum',
    tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    sourceId: 'coinmarketcap:24478',
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should map coinmarketcap quote into snapshot', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: {
            '24478': {
              id: 24478,
              symbol: 'PEPE',
              quote: {
                USD: {
                  price: 0.0000123,
                  percent_change_1h: 2.5,
                  percent_change_24h: -1.8,
                  percent_change_7d: 5.6,
                  percent_change_30d: 12.3,
                },
              },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBeCloseTo(0.0000123);
    expect(result.change1hPct).toBe(2.5);
    expect(result.change24hPct).toBe(-1.8);
    expect(result.change7dPct).toBe(5.6);
    expect(result.change30dPct).toBe(12.3);
    expect(result.sourceUsed).toBe('coinmarketcap');
    expect(result.degraded).toBe(false);
  });

  it('should return unavailable snapshot when source fails', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500 }) as Response,
    ) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBeNull();
    expect(result.change1hPct).toBeNull();
    expect(result.change24hPct).toBeNull();
    expect(result.change7dPct).toBeNull();
    expect(result.change30dPct).toBeNull();
    expect(result.sourceUsed).toBe('market_unavailable');
    expect(result.degraded).toBe(true);
  });
});

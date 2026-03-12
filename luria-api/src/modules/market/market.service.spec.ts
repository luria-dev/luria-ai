import { MarketService } from './market.service';

describe('MarketService.fetchPrice', () => {
  const identity = {
    symbol: 'PEPE',
    chain: 'ethereum',
    tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    pairAddress: '0xpair',
    quoteToken: 'USDT' as const,
    sourceId: 'dexscreener',
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should merge dexscreener short windows with coingecko mid windows', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/latest/dex/pairs/')) {
        return {
          ok: true,
          json: async () => ({
            pair: {
              priceUsd: '0.0000123',
              priceChange: {
                h1: '2.5',
                h24: '-1.8',
              },
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          market_data: {
            current_price: { usd: 0.0000122 },
            price_change_percentage_24h: -1.7,
            price_change_percentage_7d: 5.6,
            price_change_percentage_30d: 12.3,
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
    expect(result.sourceUsed).toBe('dexscreener+coingecko');
    expect(result.degraded).toBe(false);
  });

  it('should fallback to coingecko when dexscreener pair fetch fails', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/latest/dex/pairs/')) {
        return {
          ok: false,
          status: 500,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          market_data: {
            current_price: { usd: 1234.56 },
            price_change_percentage_24h: 1.2,
            price_change_percentage_7d: 8.9,
            price_change_percentage_30d: 15.4,
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBe(1234.56);
    expect(result.change1hPct).toBeNull();
    expect(result.change24hPct).toBe(1.2);
    expect(result.change7dPct).toBe(8.9);
    expect(result.change30dPct).toBe(15.4);
    expect(result.sourceUsed).toBe('coingecko');
    expect(result.degraded).toBe(false);
  });
});

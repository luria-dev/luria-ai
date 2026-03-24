import { MarketService } from './market.service';

describe('MarketService.fetchPrice', () => {
  const identity = {
    symbol: 'UNI',
    chain: 'ethereum',
    tokenAddress: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    sourceId: 'coingecko:uniswap',
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps CoinGecko market_data into snapshot (including usd change maps)', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          market_data: {
            current_price: { usd: 4.02 },
            market_cap: { usd: 2538196620 },
            price_change_percentage_1h_in_currency: { usd: 0.02078 },
            price_change_percentage_24h_in_currency: { usd: -0.84716 },
            price_change_percentage_7d_in_currency: { usd: 1.99458 },
            price_change_percentage_30d_in_currency: { usd: 12.15153 },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBe(4.02);
    expect(result.marketCapUsd).toBe(2538196620);
    expect(result.change1hPct).toBe(0.02078);
    expect(result.change24hPct).toBe(-0.84716);
    expect(result.change7dPct).toBe(1.99458);
    expect(result.change30dPct).toBe(12.15153);
    expect(result.sourceUsed).toBe('coingecko');
    expect(result.degraded).toBe(false);
    expect(result.degradeReason).toBeUndefined();
  });

  it('marks PRICE_CHANGE_24H_MISSING when usd 24h change is absent', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          market_data: {
            current_price: { usd: 4.02 },
            market_cap: { usd: 2538196620 },
            price_change_percentage_1h_in_currency: { usd: 0.02078 },
            price_change_percentage_24h_in_currency: { eur: -0.84716 },
            price_change_percentage_7d_in_currency: { usd: 1.99458 },
            price_change_percentage_30d_in_currency: { usd: 12.15153 },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBe(4.02);
    expect(result.change24hPct).toBeNull();
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe('PRICE_CHANGE_24H_MISSING');
  });

  it('returns unavailable snapshot with HTTP error classification', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 401 }) as Response,
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
    expect(result.degradeReason).toBe('COINGECKO_HTTP_401');
  });

  it('returns unavailable snapshot with connect-timeout classification', async () => {
    const error = new TypeError('fetch failed') as TypeError & {
      cause?: { code?: string };
    };
    error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };

    global.fetch = jest.fn(async () => {
      throw error;
    }) as typeof fetch;

    const service = new MarketService();
    const result = await service.fetchPrice(identity);

    expect(result.priceUsd).toBeNull();
    expect(result.sourceUsed).toBe('market_unavailable');
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe('COINGECKO_CONNECT_TIMEOUT');
  });
});

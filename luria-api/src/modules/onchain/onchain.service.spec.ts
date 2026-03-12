import { OnchainService } from './onchain.service';

describe('OnchainService.fetchCexNetflow', () => {
  const identity = {
    symbol: 'ETH',
    chain: 'ethereum',
    tokenAddress: '0xeeee',
    pairAddress: '0xpair',
    quoteToken: 'USDT' as const,
    sourceId: 'dexscreener',
  };

  const originalFetch = global.fetch;
  const originalApiKey = process.env.COINGLASS_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.COINGLASS_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('should return degraded snapshot when coinglass api key is missing', async () => {
    delete process.env.COINGLASS_API_KEY;
    const service = new OnchainService();
    const snapshot = await service.fetchCexNetflow(identity, '24h');

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degradeReason).toBe('CEX_NETFLOW_SOURCE_NOT_FOUND');
  });

  it('should aggregate exchange netflow from coinglass response', async () => {
    process.env.COINGLASS_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [
            { exchange: 'binance', inflow: 1000000, outflow: 1500000 },
            { exchange: 'bybit', inflow: 500000, outflow: 700000 },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const service = new OnchainService();
    const snapshot = await service.fetchCexNetflow(identity, '24h');

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toEqual(['coinglass']);
    expect(snapshot.inflowUsd).toBe(1500000);
    expect(snapshot.outflowUsd).toBe(2200000);
    expect(snapshot.netflowUsd).toBe(-700000);
    expect(snapshot.signal).toBe('buy_pressure');
    expect(snapshot.exchanges.length).toBe(2);
  });
});

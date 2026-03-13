import { TechnicalService } from './technical.service';

describe('TechnicalService.fetchSnapshot', () => {
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

  it('should calculate indicators from coinmarketcap price series', async () => {
    const prices: Array<{ quote: { USD: { price: number } } }> = [];
    for (let i = 0; i < 160; i += 1) {
      prices.push({
        quote: {
          USD: {
            price: 1 + i * 0.01,
          },
        },
      });
    }

    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({ data: { quotes: prices } }),
      } as Response;
    }) as typeof fetch;

    const service = new TechnicalService();
    const snapshot = await service.fetchSnapshot(identity, '24h');

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toBe('coinmarketcap');
    expect(snapshot.rsi.value).not.toBeNull();
    expect(snapshot.macd.macd).not.toBeNull();
    expect(snapshot.ma.ma99).not.toBeNull();
    expect(snapshot.boll.middle).not.toBeNull();
  });

  it('should return unavailable snapshot when source fails', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500 }) as Response,
    ) as typeof fetch;

    const service = new TechnicalService();
    const snapshot = await service.fetchSnapshot(identity, '7d');

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.sourceUsed).toBe('technical_unavailable');
    expect(snapshot.degradeReason).toBe('TECHNICAL_PRICE_SERIES_INSUFFICIENT');
  });
});

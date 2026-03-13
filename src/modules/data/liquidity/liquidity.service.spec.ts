import { LiquidityService } from './liquidity.service';

describe('LiquidityService.fetchSnapshot', () => {
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
    delete process.env.LIQUIDITY_DROP_ALERT_PCT;
  });

  it('should return unavailable snapshot when pair fetch fails', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500 }) as Response,
    ) as typeof fetch;

    const service = new LiquidityService();
    const snapshot = await service.fetchSnapshot(identity);

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.sourceUsed).toBe('liquidity_unavailable');
    expect(snapshot.degradeReason).toBe('LIQUIDITY_SOURCE_NOT_FOUND');
  });

  it('should compute 1h drop from in-memory baseline and trigger withdrawal risk', async () => {
    process.env.LIQUIDITY_DROP_ALERT_PCT = '-20';
    const nowMs = new Date('2026-03-12T00:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);

    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              quote_token_symbol: 'USDT',
              liquidity_usd: 800000,
              volume_24h: 12000000,
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const service = new LiquidityService();
    (
      service as unknown as {
        liquidityHistory: Map<
          string,
          Array<{ atMs: number; liquidityUsd: number }>
        >;
      }
    ).liquidityHistory.set(
      'ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933',
      [
        {
          atMs: nowMs - 61 * 60 * 1000,
          liquidityUsd: 1000000,
        },
      ],
    );

    const snapshot = await service.fetchSnapshot(identity);

    expect(snapshot.liquidityUsd).toBe(800000);
    expect(snapshot.liquidity1hAgoUsd).toBe(1000000);
    expect(snapshot.liquidityDrop1hPct).toBe(-20);
    expect(snapshot.withdrawalRiskFlag).toBe(true);
    expect(snapshot.rugpullRiskSignal).toBe('high');
    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toBe('cmc_dex');
  });
});

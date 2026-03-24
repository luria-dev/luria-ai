import { LiquidityService } from './liquidity.service';

describe('LiquidityService.fetchSnapshot', () => {
  const tokenIdentity = {
    symbol: 'PEPE',
    chain: 'ethereum',
    tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    sourceId: 'coingecko:pepe',
  };

  const nativeIdentity = {
    symbol: 'BTC',
    chain: 'bitcoin',
    tokenAddress: '',
    sourceId: 'coingecko:bitcoin',
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    delete process.env.LIQUIDITY_DROP_ALERT_PCT;
  });

  it('returns unavailable snapshot when token pool fetch fails', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500 }) as Response,
    ) as typeof fetch;

    const service = new LiquidityService();
    const snapshot = await service.fetchSnapshot(tokenIdentity);

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.sourceUsed).toBe('liquidity_unavailable');
    expect(snapshot.degradeReason).toBe('LIQUIDITY_SOURCE_NOT_FOUND');
  });

  it('computes 1h drop from GeckoTerminal baseline and triggers withdrawal risk', async () => {
    process.env.LIQUIDITY_DROP_ALERT_PCT = '-20';
    const nowMs = new Date('2026-03-12T00:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);

    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/tokens/') && String(url).endsWith('/pools')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'eth_0xpool',
                attributes: {
                  reserve_in_usd: '1000000',
                },
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              reserve_in_usd: '800000',
              volume_usd: { h24: '12000000' },
              relationships: {
                quote_token: {
                  data: {
                    id: 'eth_usdt',
                  },
                },
              },
            },
          },
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

    const snapshot = await service.fetchSnapshot(tokenIdentity);

    expect(snapshot.liquidityUsd).toBe(800000);
    expect(snapshot.liquidity1hAgoUsd).toBe(1000000);
    expect(snapshot.liquidityDrop1hPct).toBe(-20);
    expect(snapshot.withdrawalRiskFlag).toBe(true);
    expect(snapshot.rugpullRiskSignal).toBe('high');
    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toBe('geckoterminal');
    expect(snapshot.quoteToken).toBe('USDT');
  });

  it('uses CoinGecko ticker proxy for native assets', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          tickers: [
            {
              target: 'USDT',
              converted_volume: { usd: 2801365473 },
              bid_ask_spread_percentage: 0.010014,
            },
            {
              target: 'USDT',
              converted_volume: { usd: 2728780243 },
              bid_ask_spread_percentage: 0.010043,
            },
            {
              target: 'USD',
              converted_volume: { usd: 2299536485 },
              bid_ask_spread_percentage: 0.010014,
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const service = new LiquidityService();
    const snapshot = await service.fetchSnapshot(nativeIdentity);

    expect(snapshot.sourceUsed).toBe('coingecko');
    expect(snapshot.degraded).toBe(false);
    expect(snapshot.hasUsdtOrUsdcPair).toBe(true);
    expect(snapshot.quoteToken).toBe('USDT');
    expect(snapshot.liquidityUsd).toBe(7829682201);
    expect(snapshot.volume24hUsd).toBe(7829682201);
    expect(snapshot.priceImpact1kPct).toBe(0.01);
    expect(snapshot.rugpullRiskSignal).toBe('low');
    expect(snapshot.warnings[0]).toContain('CoinGecko centralized-exchange ticker volume proxy');
  });
});

import { OnchainService } from './onchain.service';

describe('OnchainService.fetchCexNetflow', () => {
  const identity = {
    symbol: 'BTC',
    chain: 'bitcoin',
    tokenAddress: '',
    sourceId: 'coingecko:bitcoin',
  };

  const originalFetch = global.fetch;
  const originalSantimentKey = process.env.SANTIMENT_ACCESS_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SANTIMENT_ACCESS_KEY = originalSantimentKey;
    jest.restoreAllMocks();
  });

  it('returns degraded snapshot when Santiment api key is missing', async () => {
    delete process.env.SANTIMENT_ACCESS_KEY;

    const service = new OnchainService();
    const snapshot = await service.fetchCexNetflow(identity, '24h');

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degradeReason).toBe('CEX_NETFLOW_SOURCE_NOT_FOUND');
  });

  it('uses delayed historical fallback when recent window is subscription-limited', async () => {
    process.env.SANTIMENT_ACCESS_KEY = 'test-key';

    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        variables?: {
          metric?: string;
          from?: string;
          to?: string;
          owner?: string;
        };
      };

      const variables = body.variables ?? {};
      const metric = variables.metric;
      const from = variables.from;
      const to = variables.to;

      if (
        (metric === 'exchange_inflow_usd' || metric === 'exchange_outflow_usd') &&
        to === 'utc_now'
      ) {
        return {
          ok: true,
          json: async () => ({
            data: {
              getMetric: {
                timeseriesData: null,
              },
            },
            errors: [
              {
                message:
                  'Upgrade to a higher tier in order to access more data.',
              },
            ],
          }),
        } as Response;
      }

      if (metric === 'exchange_inflow_usd' && from === 'utc_now-60d') {
        return {
          ok: true,
          json: async () => ({
            data: {
              getMetric: {
                timeseriesData: [
                  { datetime: '2026-01-23T00:00:00Z', value: 100 },
                  { datetime: '2026-01-24T00:00:00Z', value: 60 },
                ],
              },
            },
          }),
        } as Response;
      }

      if (metric === 'exchange_outflow_usd' && from === 'utc_now-60d') {
        return {
          ok: true,
          json: async () => ({
            data: {
              getMetric: {
                timeseriesData: [
                  { datetime: '2026-01-23T00:00:00Z', value: 80 },
                  { datetime: '2026-01-24T00:00:00Z', value: 50 },
                ],
              },
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          data: {
            getMetric: {
              timeseriesData: [],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new OnchainService();
    const snapshot = await service.fetchCexNetflow(identity, '24h');

    expect(snapshot.sourceUsed).toEqual(['santiment']);
    expect(snapshot.inflowUsd).toBe(160);
    expect(snapshot.outflowUsd).toBe(130);
    expect(snapshot.netflowUsd).toBe(30);
    expect(snapshot.signal).toBe('sell_pressure');
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degradeReason).toBe('CEX_NETFLOW_DELAYED_30D_FALLBACK');
  });

  it('returns current-window data when Santiment recent query is available', async () => {
    process.env.SANTIMENT_ACCESS_KEY = 'test-key';

    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        variables?: {
          metric?: string;
        };
      };
      const metric = body.variables?.metric;

      if (metric === 'exchange_inflow_usd') {
        return {
          ok: true,
          json: async () => ({
            data: {
              getMetric: {
                timeseriesData: [
                  { datetime: '2026-03-24T00:00:00Z', value: 1000000 },
                ],
              },
            },
          }),
        } as Response;
      }

      if (metric === 'exchange_outflow_usd') {
        return {
          ok: true,
          json: async () => ({
            data: {
              getMetric: {
                timeseriesData: [
                  { datetime: '2026-03-24T00:00:00Z', value: 1500000 },
                ],
              },
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          data: {
            getMetric: {
              timeseriesData: [],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new OnchainService();
    const snapshot = await service.fetchCexNetflow(identity, '24h');

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toEqual(['santiment']);
    expect(snapshot.inflowUsd).toBe(1000000);
    expect(snapshot.outflowUsd).toBe(1500000);
    expect(snapshot.netflowUsd).toBe(-500000);
    expect(snapshot.signal).toBe('buy_pressure');
  });
});

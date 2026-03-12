import { SecurityService } from './security.service';

describe('SecurityService.fetchSnapshot', () => {
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

  it('should map goplus response into non-degraded snapshot', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          result: {
            [identity.tokenAddress.toLowerCase()]: {
              is_open_source: '1',
              is_honeypot: '0',
              cannot_sell_all: '0',
              is_blacklisted: '0',
              owner_address: '0x0000000000000000000000000000000000000000',
              is_mintable: '0',
              buy_tax: '2',
              sell_tax: '3',
              is_proxy: '0',
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const service = new SecurityService();
    const snapshot = await service.fetchSnapshot(identity);

    expect(snapshot.sourceUsed).toBe('goplus');
    expect(snapshot.degraded).toBe(false);
    expect(snapshot.isHoneypot).toBe(false);
    expect(snapshot.isOwnerRenounced).toBe(true);
    expect(snapshot.canTradeSafely).toBe(true);
    expect(snapshot.riskLevel).toBe('low');
  });

  it('should throw when goplus source is unavailable (no degrade fallback)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;

    const service = new SecurityService();
    await expect(service.fetchSnapshot(identity)).rejects.toThrow('SECURITY_FETCH_FAILED');
  });
});

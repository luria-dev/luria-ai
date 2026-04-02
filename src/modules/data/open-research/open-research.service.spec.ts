import { OpenResearchService } from './open-research.service';

describe('OpenResearchService.fetchSnapshot', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  const identity = {
    symbol: 'SOL',
    chain: 'solana',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    sourceId: 'coingecko:solana',
  };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('should prioritize official, rootdata, and media sources before ddg', async () => {
    process.env.ROOTDATA_ACCESS_KEY = 'test-rootdata-key';

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://solana.com/news?format=rss') {
        return {
          ok: true,
          text: async () => `
            <rss><channel>
              <item>
                <title>Solana announces ecosystem growth update</title>
                <link>https://solana.com/news/ecosystem-growth</link>
                <description>Solana ecosystem growth and validator adoption continue.</description>
                <pubDate>Wed, 02 Apr 2026 08:00:00 GMT</pubDate>
              </item>
            </channel></rss>
          `,
        } as Response;
      }

      if (url === 'https://solana.com/news') {
        return {
          ok: true,
          text: async () => `
            <html><body>
              <a href="/news/network-upgrade">Solana network upgrade improves throughput</a>
            </body></html>
          `,
        } as Response;
      }

      if (url === 'https://www.coindesk.com/arc/outboundfeeds/rss/') {
        return {
          ok: true,
          text: async () => `
            <rss><channel>
              <item>
                <title>Solana price drivers point to ecosystem usage</title>
                <link>https://www.coindesk.com/markets/2026/04/02/solana-price-drivers</link>
                <description>Developers and users keep returning to Solana.</description>
                <pubDate>Wed, 02 Apr 2026 09:00:00 GMT</pubDate>
              </item>
            </channel></rss>
          `,
        } as Response;
      }

      if (url === 'https://decrypt.co/feed') {
        return {
          ok: true,
          text: async () => '<rss><channel></channel></rss>',
        } as Response;
      }

      if (url === 'https://blockworks.co/feed') {
        return {
          ok: true,
          text: async () => '<rss><channel></channel></rss>',
        } as Response;
      }

      if (url === 'https://theblock.co/rss.xml') {
        return {
          ok: true,
          text: async () => '<rss><channel></channel></rss>',
        } as Response;
      }

      if (url === 'https://api.rootdata.com/open/ser_inv') {
        return {
          ok: true,
          json: async () => ({
            data: [{ type: 1, project_id: 42 }],
          }),
        } as Response;
      }

      if (
        url === 'https://api.rootdata.com/open/get_item' &&
        init?.body ===
          JSON.stringify({
            project_id: 42,
            include_team: 1,
            include_investors: 1,
          })
      ) {
        return {
          ok: true,
          json: async () => ({
            item: {
              project_name: 'Solana',
              one_liner: 'High-throughput blockchain for consumer apps.',
              rootdataurl: 'https://www.rootdata.com/Projects/detail/Solana',
              tags: ['L1', 'Payments'],
              investors: [{ name: 'a16z' }],
            },
          }),
        } as Response;
      }

      if (url === 'https://api.rootdata.com/open/get_fac') {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                round_name: 'Series A',
                amount_usd: 20000000,
                published_at: '2026-04-01T00:00:00Z',
                investors: ['a16z', 'Polychain'],
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('duckduckgo.com')) {
        return {
          ok: true,
          text: async () => `
            <html>
              <a class="result__a" href="https://example.com/ddg-sol">Solana article from DDG</a>
              <div class="result__snippet">Search fallback result.</div>
            </html>
          `,
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        text: async () => '',
      } as Response;
    }) as typeof fetch;

    global.fetch = fetchMock;

    const service = new OpenResearchService();
    const snapshot = await service.fetchSnapshot({
      query: 'SOL的上涨更偏基本面还是情绪？',
      identity,
      depth: 'standard',
      topics: ['solana fundamentals adoption activity', 'solana sentiment speculation'],
      goals: ['Answer the user explicit sub-questions with current public evidence.'],
      preferredSources: ['solana.com', 'rootdata.com', 'coindesk.com'],
    });

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toEqual(
      expect.arrayContaining(['solana.com', 'rootdata.com', 'coindesk.com']),
    );
    expect(snapshot.items[0]?.source).toBe('solana.com');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('duckduckgo.com'),
      expect.anything(),
    );
  });

  it('should fall back to duckduckgo when structured sources are insufficient', async () => {
    process.env.ROOTDATA_ACCESS_KEY = '';

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('duckduckgo.com')) {
        return {
          ok: true,
          text: async () => `
            <html>
              <a class="result__a" href="https://example.com/eth-l2">Ethereum layer 2 progress update</a>
              <div class="result__snippet">Ethereum layer 2 ecosystem keeps expanding.</div>
            </html>
          `,
        } as Response;
      }

      return {
        ok: false,
        status: 500,
        text: async () => '',
      } as Response;
    }) as typeof fetch;

    const service = new OpenResearchService();
    const snapshot = await service.fetchSnapshot({
      query: 'ETH以太坊最近有什么新动向，L2进展咋样？',
      identity: {
        symbol: 'ETH',
        chain: 'ethereum',
        tokenAddress: '',
        sourceId: 'coingecko:ethereum',
      },
      depth: 'standard',
      topics: ['layer 2 progress around ETH'],
      goals: ['Use external evidence to confirm the report conclusion.'],
      preferredSources: ['ethereum.org', 'l2beat.com'],
    });

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.sourceUsed).toContain('example.com');
  });
});

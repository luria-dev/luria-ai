import type {
  AnalyzeCandidate,
  AnalyzeIdentity,
  PriceSnapshot,
  TechnicalSnapshot,
} from '../../../data/contracts/analyze-contracts';
import { MarketService } from '../../../modules/data/market/market.service';
import { SearcherService } from '../../../modules/data/searcher/searcher.service';
import { TechnicalService } from '../../../modules/data/technical/technical.service';
import { LlmRuntimeService } from '../../../modules/workflow/runtime/llm-runtime.service';
import { InstantChatService } from './instant-chat.service';
import { InstantConversationService } from './instant-conversation.service';

describe('InstantChatService', () => {
  const identity: AnalyzeIdentity = {
    symbol: 'BTC',
    chain: 'bitcoin',
    tokenAddress: '',
    sourceId: 'coingecko:bitcoin',
  };

  const marketSnapshot: PriceSnapshot = {
    priceUsd: 68000,
    marketCapUsd: 1300000000000,
    change1hPct: 0.4,
    change24hPct: 2.6,
    change7dPct: 8.2,
    change30dPct: 14.8,
    marketCapRank: 1,
    circulatingSupply: 19600000,
    totalSupply: 21000000,
    maxSupply: 21000000,
    fdvUsd: 1420000000000,
    totalVolume24hUsd: 25000000000,
    athUsd: 73750,
    atlUsd: 65,
    athChangePct: -7.8,
    atlChangePct: 104500,
    asOf: '2026-03-29T00:00:00.000Z',
    sourceUsed: 'coingecko',
    degraded: false,
  };

  const technicalSnapshot: TechnicalSnapshot = {
    rsi: {
      period: 14,
      value: 58.3,
      signal: 'neutral',
    },
    macd: {
      macd: 120.5,
      signalLine: 95.2,
      histogram: 25.3,
      signal: 'bullish',
    },
    ma: {
      ma7: 67100,
      ma25: 64800,
      ma99: 60200,
      signal: 'bullish',
    },
    boll: {
      upper: 69000,
      middle: 66200,
      lower: 63400,
      bandwidth: 0.08,
      signal: 'neutral',
    },
    atr: {
      value: 1350,
      period: 14,
    },
    swingHigh: 69500,
    swingLow: 64100,
    summarySignal: 'bullish',
    asOf: '2026-03-29T00:00:00.000Z',
    sourceUsed: 'coingecko',
    degraded: false,
  };

  function createService(overrides?: {
    searcherResolve?: jest.Mock;
    generateText?: jest.Mock;
  }) {
    const llm = {
      generateText:
        overrides?.generateText ??
        jest.fn().mockResolvedValue({
          content: 'mock-reply',
          meta: {
            model: 'qwen3-max',
            responseId: 'resp_1',
          },
        }),
    } as Pick<LlmRuntimeService, 'generateText'>;

    const searcher = {
      resolve:
        overrides?.searcherResolve ??
        jest.fn().mockResolvedValue({
          kind: 'resolved' as const,
          identity,
        }),
    } as Pick<SearcherService, 'resolve'>;

    const market = {
      fetchPrice: jest.fn().mockResolvedValue(marketSnapshot),
    } as Pick<MarketService, 'fetchPrice'>;

    const technical = {
      fetchSnapshot: jest.fn().mockResolvedValue(technicalSnapshot),
    } as Pick<TechnicalService, 'fetchSnapshot'>;

    const service = new InstantChatService(
      llm as LlmRuntimeService,
      new InstantConversationService(),
      searcher as SearcherService,
      market as MarketService,
      technical as TechnicalService,
    );

    return {
      service,
      llm,
      searcher,
      market,
      technical,
    };
  }

  it('injects resolved market and technical snapshots into the prompt', async () => {
    const { service, llm, searcher, market, technical } = createService();

    await service.reply({
      threadId: 'thread-1',
      requestId: 'req-1',
      message: 'BTC 现在能买吗',
      timeWindow: '24h',
      lang: 'cn',
    });

    expect(searcher.resolve).toHaveBeenCalledWith('BTC 现在能买吗');
    expect(market.fetchPrice).toHaveBeenCalledWith(identity);
    expect(technical.fetchSnapshot).toHaveBeenCalledWith(identity, '24h');
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Asset resolution: resolved'),
      }),
    );
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Price USD: 68000'),
      }),
    );
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('RSI14: 58.3'),
      }),
    );
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Bollinger upper: 69000'),
      }),
    );
  });

  it('asks for clarification when asset resolution is ambiguous', async () => {
    const candidates: AnalyzeCandidate[] = [
      {
        candidateId: '1',
        tokenName: 'Pepe Ethereum',
        symbol: 'PEPE',
        chain: 'ethereum',
        tokenAddress: '0x111',
        quoteToken: 'USDT',
        sourceId: 'coingecko:pepe',
      },
      {
        candidateId: '2',
        tokenName: 'Pepe Base',
        symbol: 'PEPE',
        chain: 'base',
        tokenAddress: '0x222',
        quoteToken: 'USDC',
        sourceId: 'coingecko:pepe-base',
      },
    ];
    const { service, llm, market, technical } = createService({
      searcherResolve: jest.fn().mockResolvedValue({
        kind: 'ambiguous' as const,
        candidates,
      }),
    });

    await service.reply({
      threadId: 'thread-2',
      requestId: 'req-2',
      message: 'PEPE 怎么看',
      timeWindow: '24h',
      lang: 'cn',
    });

    expect(market.fetchPrice).not.toHaveBeenCalled();
    expect(technical.fetchSnapshot).not.toHaveBeenCalled();
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Asset resolution: ambiguous'),
      }),
    );
    expect(llm.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining(
          'Ask the user to specify the exact symbol or chain before giving token-specific numbers.',
        ),
      }),
    );
  });
});

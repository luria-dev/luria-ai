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

  function intentJson(
    overrides?: Partial<{
      assetDecision: 'explicit' | 'inherit' | 'none';
      assetQuery: string | null;
      timeDecision: 'explicit' | 'inherit' | 'none';
      resolvedTimeWindow: '24h' | '7d' | null;
      goalDecision: 'explicit' | 'inherit' | 'none';
      resolvedGoal: string | null;
      scopeDecision: 'explicit' | 'inherit' | 'none';
      resolvedScope: 'single_asset' | 'comparison' | 'multi_asset' | 'general' | null;
      needsClarification: boolean;
    }>,
  ) {
    return JSON.stringify({
      assetDecision: 'none',
      assetQuery: null,
      timeDecision: 'none',
      resolvedTimeWindow: null,
      goalDecision: 'none',
      resolvedGoal: null,
      scopeDecision: 'none',
      resolvedScope: null,
      needsClarification: false,
      ...overrides,
    });
  }

  function createService(overrides?: {
    searcherResolve?: jest.Mock;
    generateText?: jest.Mock;
  }) {
    const conversations = new InstantConversationService();
    const llm = {
      generateText:
        overrides?.generateText ??
        jest
          .fn()
          .mockResolvedValueOnce({
            content: intentJson(),
            meta: {
              model: 'qwen3-max',
              responseId: 'intent_1',
            },
          })
          .mockResolvedValueOnce({
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
      conversations,
      searcher as SearcherService,
      market as MarketService,
      technical as TechnicalService,
    );

    return {
      conversations,
      service,
      llm,
      searcher,
      market,
      technical,
    };
  }

  it('injects resolved market and technical snapshots into the answer prompt', async () => {
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

    const prompts = (llm.generateText as jest.Mock).mock.calls.map(
      ([input]) => input.userPrompt as string,
    );
    expect(prompts.some((prompt) => prompt.includes('Asset resolution: resolved'))).toBe(
      true,
    );
    expect(prompts.some((prompt) => prompt.includes('Price USD: 68000'))).toBe(
      true,
    );
    expect(prompts.some((prompt) => prompt.includes('RSI14: 58.3'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Bollinger upper: 69000'))).toBe(
      true,
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

    const generateText = jest
      .fn()
      .mockResolvedValueOnce({
        content: intentJson(),
        meta: {
          model: 'qwen3-max',
          responseId: 'intent_1',
        },
      })
      .mockResolvedValueOnce({
        content: 'clarify',
        meta: {
          model: 'qwen3-max',
          responseId: 'resp_1',
        },
      });

    const { service, llm, market, technical } = createService({
      searcherResolve: jest.fn().mockResolvedValue({
        kind: 'ambiguous' as const,
        candidates,
      }),
      generateText,
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

    const prompts = (llm.generateText as jest.Mock).mock.calls.map(
      ([input]) => input.userPrompt as string,
    );
    expect(prompts.some((prompt) => prompt.includes('Asset resolution: ambiguous'))).toBe(
      true,
    );
    expect(
      prompts.some((prompt) =>
        prompt.includes(
          'Ask the user to specify the exact symbol or chain before giving token-specific numbers.',
        ),
      ),
    ).toBe(true);
  });

  it('reuses the last resolved identity based on prior instant state', async () => {
    const generateText = jest
      .fn()
      .mockResolvedValueOnce({
        content: intentJson({
          assetDecision: 'inherit',
          timeDecision: 'inherit',
          goalDecision: 'explicit',
          resolvedGoal: 'risk_levels',
          scopeDecision: 'inherit',
        }),
        meta: {
          model: 'qwen3-max',
          responseId: 'intent_2',
        },
      })
      .mockResolvedValueOnce({
        content: 'mock-follow-up',
        meta: {
          model: 'qwen3-max',
          responseId: 'resp_2',
        },
      });

    const { service, conversations, llm, searcher, market, technical } =
      createService({
        searcherResolve: jest.fn().mockResolvedValue({
          kind: 'not_found' as const,
        }),
        generateText,
      });

    conversations.saveTurn({
      threadId: 'thread-follow-up',
      requestId: 'req-prev',
      userMessage: 'BTC 适合建仓吗',
      assistantMessage: 'prev',
      responseId: 'resp-prev',
      resolvedIdentity: identity,
      timeWindow: '24h',
      goal: 'analysis',
      scope: 'single_asset',
      turnContext: {
        assetMention: 'BTC',
        timeWindow: '24h',
        goal: 'analysis',
        scope: 'single_asset',
      },
    });

    const result = await service.reply({
      threadId: 'thread-follow-up',
      requestId: 'req-follow-up',
      message: '那支撑位和止损怎么设？',
      timeWindow: '24h',
      lang: 'cn',
    });

    expect(searcher.resolve).not.toHaveBeenCalled();
    expect(market.fetchPrice).toHaveBeenCalledWith(identity);
    expect(technical.fetchSnapshot).toHaveBeenCalledWith(identity, '24h');
    expect(result.resolvedIdentity).toEqual(identity);
    expect(result.goal).toBe('risk_levels');

    const parsePrompt = (llm.generateText as jest.Mock).mock.calls[0][0]
      .userPrompt as string;
    expect(parsePrompt).toContain('Asset track:');
    expect(parsePrompt).toContain('value=BTC');

    const state = conversations.get('thread-follow-up');
    expect(state?.lastResolvedIdentity).toEqual(identity);
    expect(state?.lastGoal).toBe('risk_levels');
  });

  it('switches to an explicit 7d window and saves it into conversation state', async () => {
    const generateText = jest
      .fn()
      .mockResolvedValueOnce({
        content: intentJson({
          assetDecision: 'inherit',
          timeDecision: 'explicit',
          resolvedTimeWindow: '7d',
          goalDecision: 'inherit',
          scopeDecision: 'inherit',
        }),
        meta: {
          model: 'qwen3-max',
          responseId: 'intent_3',
        },
      })
      .mockResolvedValueOnce({
        content: 'mock-7d',
        meta: {
          model: 'qwen3-max',
          responseId: 'resp_3',
        },
      });

    const { service, conversations, technical } = createService({
      searcherResolve: jest.fn().mockResolvedValue({
        kind: 'not_found' as const,
      }),
      generateText,
    });

    conversations.saveTurn({
      threadId: 'thread-window',
      requestId: 'req-prev',
      userMessage: 'BTC 24h 怎么看',
      assistantMessage: 'prev',
      responseId: 'resp-prev',
      resolvedIdentity: identity,
      timeWindow: '24h',
      goal: 'analysis',
      scope: 'single_asset',
      turnContext: {
        assetMention: 'BTC',
        timeWindow: '24h',
        goal: 'analysis',
        scope: 'single_asset',
      },
    });

    const result = await service.reply({
      threadId: 'thread-window',
      requestId: 'req-window',
      message: '那看 7 天周期呢？',
      timeWindow: '24h',
      lang: 'cn',
    });

    expect(technical.fetchSnapshot).toHaveBeenCalledWith(identity, '7d');
    expect(result.timeWindow).toBe('7d');
    expect(conversations.get('thread-window')?.lastTimeWindow).toBe('7d');
  });
});

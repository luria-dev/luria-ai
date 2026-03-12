import { Injectable } from '@nestjs/common';
import { AnalyzeIdentity, NewsItem, NewsSnapshot } from '../../core/contracts/analyze-contracts';

@Injectable()
export class NewsService {
  readonly moduleName = 'news';

  private readonly mockNews: Record<string, NewsItem[]> = {
    'SOL:solana': [
      {
        id: 'news-sol-001',
        title: 'Solana ecosystem announces new DePIN partnership expansion',
        url: 'https://example.com/news/sol-001',
        source: 'cryptopanic',
        publishedAt: '2026-03-01T08:00:00.000Z',
        category: 'partnership',
        relevanceScore: 0.91,
      },
      {
        id: 'news-sol-002',
        title: 'SOL derivatives open interest rises with volatility pick-up',
        url: 'https://example.com/news/sol-002',
        source: 'surf',
        publishedAt: '2026-03-01T16:20:00.000Z',
        category: 'market',
        relevanceScore: 0.86,
      },
    ],
    'ETH:ethereum': [
      {
        id: 'news-eth-001',
        title: 'Ethereum L2 activity grows after new protocol integration',
        url: 'https://example.com/news/eth-001',
        source: 'cryptopanic',
        publishedAt: '2026-03-01T11:10:00.000Z',
        category: 'project',
        relevanceScore: 0.88,
      },
      {
        id: 'news-eth-002',
        title: 'Major exchange reports stronger ETH spot demand this week',
        url: 'https://example.com/news/eth-002',
        source: 'surf',
        publishedAt: '2026-03-01T19:35:00.000Z',
        category: 'market',
        relevanceScore: 0.84,
      },
    ],
  };

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  fetchLatest(identity: AnalyzeIdentity, limit = 5): NewsSnapshot {
    const key = `${identity.symbol}:${identity.chain}`;
    const rawItems = this.mockNews[key] ?? [];

    if (rawItems.length === 0) {
      return {
        items: [],
        asOf: new Date().toISOString(),
        sourceUsed: 'news_unavailable',
        degraded: true,
        degradeReason: 'NEWS_SOURCE_NOT_FOUND',
      };
    }

    // Keep only high-relevance items to avoid noisy headlines.
    const filtered = rawItems
      .filter((item) => item.relevanceScore >= 0.75)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);

    return {
      items: filtered,
      asOf: new Date().toISOString(),
      sourceUsed: 'news_mock',
      degraded: filtered.length === 0,
      degradeReason: filtered.length === 0 ? 'NO_MEANINGFUL_NEWS' : undefined,
    };
  }
}

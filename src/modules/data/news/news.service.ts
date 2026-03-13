import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  NewsItem,
  NewsSnapshot,
} from '../../../data/contracts/analyze-contracts';

type MessariNewsRow = {
  id?: string | number;
  title?: string;
  url?: string;
  published_at?: string;
  publishedAt?: string;
  source?: string;
  references?: Array<{ url?: string }>;
  tags?: Array<string | { slug?: string; name?: string }>;
};

type MessariNewsResponse = {
  data?: unknown;
};

@Injectable()
export class NewsService {
  readonly moduleName = 'news';
  private readonly logger = new Logger(NewsService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchLatest(
    identity: AnalyzeIdentity,
    limit = 5,
  ): Promise<NewsSnapshot> {
    const items = await this.fetchMessariNews(
      identity,
      Math.max(limit * 2, 10),
    );
    const filtered = items
      .filter((item) => item.relevanceScore >= 0.6)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);

    if (filtered.length === 0) {
      return {
        items: [],
        asOf: new Date().toISOString(),
        sourceUsed: 'news_unavailable',
        degraded: true,
        degradeReason:
          items.length === 0 ? 'NEWS_SOURCE_NOT_FOUND' : 'NO_MEANINGFUL_NEWS',
      };
    }

    return {
      items: filtered,
      asOf: new Date().toISOString(),
      sourceUsed: 'messari',
      degraded: false,
    };
  }

  private async fetchMessariNews(
    identity: AnalyzeIdentity,
    limit: number,
  ): Promise<NewsItem[]> {
    const baseUrl =
      process.env.MESSARI_NEWS_URL ?? 'https://data.messari.io/api/v1/news';
    const timeoutMs = Number(process.env.MESSARI_TIMEOUT_MS ?? 5000);
    const symbol = identity.symbol.trim().toUpperCase();
    const params = new URLSearchParams({
      limit: String(limit),
      sort: 'published_at',
      direction: 'desc',
    });
    if (symbol) {
      params.set('asset_symbols', symbol);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const apiKey = process.env.MESSARI_API_KEY;
      if (apiKey?.trim()) {
        headers['x-messari-api-key'] = apiKey.trim();
      }

      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        this.logger.warn(
          `Messari news fetch failed (${response.status}) for ${identity.symbol}.`,
        );
        return [];
      }

      const body = (await response.json()) as MessariNewsResponse;
      const rows = this.extractRows(body.data);
      return rows
        .map((row) => this.toNewsItem(row, symbol))
        .filter((item): item is NewsItem => item !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Messari news unavailable for ${identity.symbol}: ${message}`,
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractRows(data: unknown): MessariNewsRow[] {
    if (Array.isArray(data)) {
      return data.filter((row): row is MessariNewsRow =>
        Boolean(row && typeof row === 'object'),
      );
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const candidates = [obj.data, obj.items, obj.news, obj.results];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return candidate.filter((row): row is MessariNewsRow =>
            Boolean(row && typeof row === 'object'),
          );
        }
      }
      if ('title' in obj) {
        return [obj as MessariNewsRow];
      }
    }
    return [];
  }

  private toNewsItem(row: MessariNewsRow, symbol: string): NewsItem | null {
    const title = (row.title ?? '').trim();
    if (!title) {
      return null;
    }

    const publishedAt = this.toIsoTime(row.published_at ?? row.publishedAt);
    if (!publishedAt) {
      return null;
    }

    const url =
      (row.url ?? '').trim() ||
      row.references
        ?.find((ref) => typeof ref?.url === 'string' && ref.url.trim())
        ?.url?.trim() ||
      '';
    if (!url) {
      return null;
    }

    const tags = this.toTagTexts(row.tags);
    const relevanceScore = this.computeRelevanceScore({
      title,
      tags,
      symbol,
    });

    return {
      id: String(row.id ?? `${publishedAt}:${title.slice(0, 24)}`),
      title,
      url,
      source: (row.source ?? 'messari').toString().trim() || 'messari',
      publishedAt,
      category: this.toCategory(title, tags),
      relevanceScore,
    };
  }

  private toTagTexts(input: MessariNewsRow['tags']): string[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const result: string[] = [];
    for (const item of input) {
      if (typeof item === 'string' && item.trim()) {
        result.push(item.trim().toLowerCase());
        continue;
      }
      if (item && typeof item === 'object') {
        const text = `${item.slug ?? item.name ?? ''}`.trim();
        if (text) {
          result.push(text.toLowerCase());
        }
      }
    }
    return [...new Set(result)];
  }

  private computeRelevanceScore(input: {
    title: string;
    tags: string[];
    symbol: string;
  }): number {
    const titleLower = input.title.toLowerCase();
    const symbolLower = input.symbol.toLowerCase();
    let score = 0.45;
    if (symbolLower && titleLower.includes(symbolLower)) {
      score += 0.3;
    }
    if (input.tags.some((tag) => tag.includes(symbolLower))) {
      score += 0.2;
    }
    if (
      input.tags.some((tag) =>
        ['security', 'listing', 'partnership', 'market'].includes(tag),
      )
    ) {
      score += 0.05;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }

  private toCategory(title: string, tags: string[]): NewsItem['category'] {
    const text = `${title} ${tags.join(' ')}`.toLowerCase();
    if (
      text.includes('security') ||
      text.includes('exploit') ||
      text.includes('hack')
    ) {
      return 'security';
    }
    if (text.includes('listing') || text.includes('listed')) {
      return 'listing';
    }
    if (text.includes('partner') || text.includes('integrat')) {
      return 'partnership';
    }
    if (
      text.includes('macro') ||
      text.includes('fed') ||
      text.includes('cpi')
    ) {
      return 'macro';
    }
    if (
      text.includes('launch') ||
      text.includes('upgrade') ||
      text.includes('protocol')
    ) {
      return 'project';
    }
    return 'market';
  }

  private toIsoTime(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }
}

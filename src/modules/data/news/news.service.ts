import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  NewsItem,
  NewsSnapshot,
} from '../../../data/contracts/analyze-contracts';

type CoinDeskNewsRow = {
  id?: string | number;
  guid?: string;
  title?: string;
  TITLE?: string;
  body?: string;
  BODY?: string;
  url?: string;
  URL?: string;
  published_at?: string;
  publishedAt?: string;
  PUBLISHED_ON?: string | number;
  source?: string;
  SOURCE?: string;
  source_data?: { name?: string; NAME?: string };
  SOURCE_DATA?: { name?: string; NAME?: string };
  tags?: Array<string | { name?: string; slug?: string }>;
  categories?: Array<string | { name?: string; slug?: string }>;
  CATEGORY_DATA?: Array<{ NAME?: string; name?: string }>;
};

type CoinDeskNewsResponse = {
  Data?: unknown;
  data?: unknown;
  items?: unknown;
  results?: unknown;
};

type NewsKeywords = {
  symbol: string;
  searchTerm: string;
  primaryTerm: string;
  terms: string[];
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
    const items = await this.fetchCoinDeskNews(
      identity,
      Math.max(limit * 4, 20),
    );
    const filtered = items
      .filter((item) => item.relevanceScore >= 0.55)
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
      sourceUsed: 'coindesk',
      degraded: false,
    };
  }

  private async fetchCoinDeskNews(
    identity: AnalyzeIdentity,
    limit: number,
  ): Promise<NewsItem[]> {
    const baseUrl =
      process.env.COINDESK_NEWS_URL ??
      'https://data-api.coindesk.com/news/v1/article/list';
    const timeoutMs = Number(process.env.COINDESK_TIMEOUT_MS ?? 5000);
    const keywords = this.buildNewsKeywords(identity);

    const params = new URLSearchParams({
      lang: 'EN',
      limit: String(limit),
    });
    if (keywords.searchTerm) {
      params.set('query', keywords.searchTerm);
      params.set('search_string', keywords.searchTerm);
    }

    const apiKey =
      process.env.COINDESK_ACCESS_KEY ?? process.env.COINDESK_API_KEY;
    if (apiKey?.trim()) {
      params.set('api_key', apiKey.trim());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        this.logger.warn(
          `CoinDesk news fetch failed (${response.status}) for ${identity.symbol}.`,
        );
        return [];
      }

      const body = (await response.json()) as CoinDeskNewsResponse;
      const rows = this.extractRows(body);
      return rows
        .map((row) => this.toNewsItem(row, keywords))
        .filter((item): item is NewsItem => item !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CoinDesk news unavailable for ${identity.symbol}: ${message}`,
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractRows(body: CoinDeskNewsResponse): CoinDeskNewsRow[] {
    const candidates = [body.Data, body.data, body.items, body.results];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((row): row is CoinDeskNewsRow =>
          Boolean(row && typeof row === 'object'),
        );
      }
    }
    return [];
  }

  private toNewsItem(
    row: CoinDeskNewsRow,
    keywords: NewsKeywords,
  ): NewsItem | null {
    const title = (row.title ?? row.TITLE ?? '').trim();
    if (!title) {
      return null;
    }

    const publishedAt = this.toIsoTime(
      row.publishedAt ?? row.published_at ?? row.PUBLISHED_ON,
    );
    if (!publishedAt) {
      return null;
    }

    const url = (row.url ?? row.URL ?? row.guid ?? '').trim();
    if (!url) {
      return null;
    }

    const tags = this.toTagTexts(row);
    const relevanceScore = this.computeRelevanceScore({
      title,
      body: row.body ?? row.BODY ?? '',
      tags,
      primaryTerm: keywords.primaryTerm,
      terms: keywords.terms,
    });

    return {
      id: String(row.id ?? row.guid ?? `${publishedAt}:${title.slice(0, 24)}`),
      title,
      url,
      source: this.resolveSource(row),
      publishedAt,
      category: this.toCategory(title, tags),
      relevanceScore,
    };
  }

  private resolveSource(row: CoinDeskNewsRow): string {
    const source =
      row.source_data?.name ??
      row.source_data?.NAME ??
      row.SOURCE_DATA?.name ??
      row.SOURCE_DATA?.NAME ??
      row.source ??
      row.SOURCE ??
      'coindesk';
    return String(source).trim() || 'coindesk';
  }

  private toTagTexts(row: CoinDeskNewsRow): string[] {
    const raw = [row.tags ?? [], row.categories ?? [], row.CATEGORY_DATA ?? []]
      .flat()
      .filter((item) => item !== null && item !== undefined);

    const result: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) {
        result.push(item.trim().toLowerCase());
        continue;
      }

      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const raw = obj.slug ?? obj.name ?? obj.NAME ?? '';
        const text =
          typeof raw === 'string' || typeof raw === 'number'
            ? String(raw).trim()
            : '';
        if (text) {
          result.push(text.toLowerCase());
        }
      }
    }

    return [...new Set(result)];
  }

  private computeRelevanceScore(input: {
    title: string;
    body: string;
    tags: string[];
    primaryTerm: string;
    terms: string[];
  }): number {
    const title = input.title.toLowerCase();
    const text = `${input.title} ${input.body}`.toLowerCase();

    const hasPrimaryInTitle = this.containsWholeTerm(title, input.primaryTerm);
    const hasTermInText = input.terms.some((term) =>
      this.containsWholeTerm(text, term),
    );
    const hasTermInTags = input.tags.some((tag) =>
      input.terms.some((term) => this.containsWholeTerm(tag, term)),
    );

    let score = 0.2;
    if (hasPrimaryInTitle) {
      score += 0.45;
    } else if (hasTermInText) {
      score += 0.3;
    }
    if (hasTermInTags) {
      score += 0.25;
    }
    if (
      input.tags.some((tag) =>
        ['security', 'listing', 'partnership', 'market', 'macro'].includes(tag),
      )
    ) {
      score += 0.05;
    }

    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }

  private buildNewsKeywords(identity: AnalyzeIdentity): NewsKeywords {
    const symbol = identity.symbol.trim().toUpperCase();
    const terms = new Set<string>();
    if (symbol) {
      terms.add(symbol.toLowerCase());
    }

    const slug = this.extractSlugFromSourceId(identity.sourceId);
    if (slug) {
      terms.add(slug);
      terms.add(slug.replace(/-/g, ' '));
    }

    for (const alias of this.getSymbolAliases(symbol)) {
      terms.add(alias);
    }

    const sortedTerms = [...terms]
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 0)
      .sort((a, b) => b.length - a.length);

    const primaryTerm =
      sortedTerms.find((term) => term !== symbol.toLowerCase()) ??
      sortedTerms[0] ??
      symbol.toLowerCase();

    return {
      symbol,
      searchTerm: primaryTerm || symbol,
      primaryTerm: primaryTerm || symbol.toLowerCase(),
      terms: sortedTerms,
    };
  }

  private extractSlugFromSourceId(sourceId: string): string | null {
    if (!sourceId || !sourceId.includes(':')) {
      return null;
    }
    const slug = sourceId.split(':')[1]?.trim().toLowerCase();
    if (!slug) {
      return null;
    }
    return slug;
  }

  private getSymbolAliases(symbol: string): string[] {
    const map: Record<string, string[]> = {
      UNI: ['uniswap'],
      LINK: ['chainlink'],
    };
    return map[symbol] ?? [];
  }

  private containsWholeTerm(text: string, term: string): boolean {
    const normalizedText = text.trim().toLowerCase();
    const normalizedTerm = term.trim().toLowerCase();
    if (!normalizedText || !normalizedTerm) {
      return false;
    }
    const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9])${escapedTerm}([^a-z0-9]|$)`, 'i');
    return pattern.test(normalizedText);
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
    if (typeof value === 'number' && Number.isFinite(value)) {
      const maybeSeconds = value > 1e12 ? value : value * 1000;
      const parsed = new Date(maybeSeconds);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return null;
    }

    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return this.toIsoTime(asNumber);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }
}

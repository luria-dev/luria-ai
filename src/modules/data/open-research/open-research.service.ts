import { Injectable, Logger } from '@nestjs/common';
import type {
  AnalyzeIdentity,
  OpenResearchItem,
  OpenResearchSnapshot,
} from '../../../data/contracts/analyze-contracts';

type OpenResearchInput = {
  query: string;
  identity: AnalyzeIdentity;
  depth: 'light' | 'standard' | 'heavy';
  topics: string[];
  goals: string[];
  preferredSources: string[];
};

@Injectable()
export class OpenResearchService {
  readonly moduleName = 'open_research';
  private readonly logger = new Logger(OpenResearchService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(input: OpenResearchInput): Promise<OpenResearchSnapshot> {
    const topicLimit = input.depth === 'heavy' ? 8 : input.depth === 'standard' ? 6 : 4;
    const goalLimit = input.depth === 'heavy' ? 6 : 4;
    const itemLimit = input.depth === 'heavy' ? 12 : input.depth === 'standard' ? 8 : 5;
    const takeawayLimit = input.depth === 'heavy' ? 5 : 4;
    const topics = this.unique(input.topics).slice(0, topicLimit);
    const goals = this.unique(input.goals).slice(0, goalLimit);
    const queries = this.buildQueries(input, topics);
    const results = await Promise.all(
      queries.map((query) => this.searchDuckDuckGo(query)),
    );
    const items = this.rankItems(
      this.uniqueItems(results.flat()),
      topics,
    ).slice(0, itemLimit);

    return {
      enabled: true,
      query: input.query,
      topics,
      goals,
      preferredSources: this.unique(input.preferredSources),
      takeaways: items
        .slice(0, takeawayLimit)
        .map((item) => `${item.source}: ${item.title}`),
      items,
      asOf: new Date().toISOString(),
      sourceUsed: this.unique(items.map((item) => item.source)),
      degraded: items.length === 0,
      degradeReason:
        items.length === 0 ? 'OPEN_RESEARCH_NO_MEANINGFUL_RESULTS' : undefined,
    };
  }

  private buildQueries(input: OpenResearchInput, topics: string[]): string[] {
    const base = `${input.identity.symbol} ${input.query}`.trim();
    const queries = [base];

    const topicQueryLimit =
      input.depth === 'heavy' ? 4 : input.depth === 'standard' ? 3 : 2;
    const goalQueryLimit = input.depth === 'heavy' ? 3 : 2;
    const sourceQueryLimit = input.depth === 'heavy' ? 3 : 2;

    for (const topic of topics.slice(0, topicQueryLimit)) {
      queries.push(`${input.identity.symbol} ${topic}`.trim());
    }

    for (const goal of input.goals.slice(0, goalQueryLimit)) {
      queries.push(`${input.identity.symbol} ${goal}`.trim());
    }

    for (const source of input.preferredSources.slice(0, sourceQueryLimit)) {
      const site = this.normalizePreferredSource(source);
      if (!site) {
        continue;
      }
      queries.push(`${base} site:${site}`);
      if (topics[0]) {
        queries.push(`${input.identity.symbol} ${topics[0]} site:${site}`.trim());
      }
    }

    return this.unique(
      queries
        .map((query) => query.replace(/\s+/g, ' ').trim())
        .filter((query) => query.length > 0),
    ).slice(0, input.depth === 'heavy' ? 8 : input.depth === 'standard' ? 5 : 3);
  }

  private async searchDuckDuckGo(query: string): Promise<OpenResearchItem[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const timeoutMs = Number(process.env.OPEN_RESEARCH_TIMEOUT_MS ?? 5000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        this.logger.warn(
          `Open research search failed (${response.status}) for query: ${query}`,
        );
        return [];
      }

      const html = await response.text();
      return this.parseDuckDuckGoResults(html, query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Open research search unavailable for query "${query}": ${message}`,
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseDuckDuckGoResults(
    html: string,
    query: string,
  ): OpenResearchItem[] {
    const normalized = html.replace(/\n/g, ' ');
    const regex =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>(?:[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|[\s\S]*?<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/gi;
    const items: OpenResearchItem[] = [];

    let match = regex.exec(normalized);
    while (match) {
      const rawUrl = this.decodeHtml(match[1] ?? '');
      const title = this.cleanHtml(match[2] ?? '');
      const snippet = this.cleanHtml(match[3] ?? '');
      const url = this.normalizeDuckDuckGoUrl(rawUrl);
      const source = this.extractSource(url);
      if (title && url) {
        items.push({
          title,
          url,
          source,
          snippet: snippet || null,
          publishedAt: null,
          topic: this.detectTopic(query, title, snippet),
          relevanceScore: this.computeRelevance(query, title, snippet),
        });
      }
      match = regex.exec(normalized);
    }

    return items;
  }

  private normalizeDuckDuckGoUrl(url: string): string {
    if (!url) {
      return '';
    }

    try {
      const parsed = new URL(url, 'https://html.duckduckgo.com');
      const redirect = parsed.searchParams.get('uddg');
      if (redirect) {
        return decodeURIComponent(redirect);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private extractSource(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'open_web';
    }
  }

  private detectTopic(query: string, title: string, snippet: string): string {
    const text = `${query} ${title} ${snippet}`.toLowerCase();
    if (text.includes('layer 2') || text.includes('l2')) {
      return 'layer2_progress';
    }
    if (
      text.includes('upgrade') ||
      text.includes('roadmap') ||
      text.includes('launch') ||
      text.includes('announce')
    ) {
      return 'recent_developments';
    }
    if (
      text.includes('driver') ||
      text.includes('catalyst') ||
      text.includes('上涨') ||
      text.includes('下跌') ||
      text.includes('risk')
    ) {
      return 'drivers_and_risks';
    }
    return 'general_research';
  }

  private computeRelevance(
    query: string,
    title: string,
    snippet: string,
  ): number {
    const haystack = `${title} ${snippet}`.toLowerCase();
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    if (tokens.length === 0) {
      return 0.3;
    }

    let score = 0.25;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += title.toLowerCase().includes(token) ? 0.18 : 0.08;
      }
    }

    return Math.min(1, Number(score.toFixed(2)));
  }

  private rankItems(
    items: OpenResearchItem[],
    topics: string[],
  ): OpenResearchItem[] {
    return [...items].sort((left, right) => {
      const topicBoostLeft = topics.some((topic) =>
        `${left.title} ${left.snippet ?? ''}`
          .toLowerCase()
          .includes(topic.toLowerCase()),
      )
        ? 0.1
        : 0;
      const topicBoostRight = topics.some((topic) =>
        `${right.title} ${right.snippet ?? ''}`
          .toLowerCase()
          .includes(topic.toLowerCase()),
      )
        ? 0.1
        : 0;
      return (
        right.relevanceScore +
        topicBoostRight -
        (left.relevanceScore + topicBoostLeft)
      );
    });
  }

  private uniqueItems(items: OpenResearchItem[]): OpenResearchItem[] {
    const seen = new Set<string>();
    const result: OpenResearchItem[] = [];
    for (const item of items) {
      const key = `${item.url}::${item.title}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  private unique(items: string[]): string[] {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  }

  private normalizePreferredSource(source: string): string {
    const trimmed = source.trim().toLowerCase();
    if (!trimmed) {
      return '';
    }

    return trimmed
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
  }

  private cleanHtml(value: string): string {
    return this.decodeHtml(value)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}

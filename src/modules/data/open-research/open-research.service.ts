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

type OpenResearchSourceKind = 'rss' | 'html';
type OpenResearchSourceTier = 'official' | 'media';

type OpenResearchSourceTarget = {
  source: string;
  url: string;
  kind: OpenResearchSourceKind;
  tier: OpenResearchSourceTier;
  topicHint?: string;
};

type OpenResearchCandidate = {
  title: string;
  url: string;
  source: string;
  snippet: string | null;
  publishedAt: string | null;
  topic: string;
  relevanceScore: number;
  tier: OpenResearchSourceTier | 'rootdata' | 'duckduckgo';
};

type RootDataSearchResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataItemResponse = {
  data?: unknown;
  result?: unknown;
  item?: unknown;
  project?: unknown;
};

type RootDataFundraisingResponse = {
  data?: unknown;
  result?: unknown;
};

const GENERAL_MEDIA_TARGETS: OpenResearchSourceTarget[] = [
  {
    source: 'coindesk.com',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    kind: 'rss',
    tier: 'media',
  },
  {
    source: 'decrypt.co',
    url: 'https://decrypt.co/feed',
    kind: 'rss',
    tier: 'media',
  },
  {
    source: 'blockworks.co',
    url: 'https://blockworks.co/feed',
    kind: 'rss',
    tier: 'media',
  },
  {
    source: 'theblock.co',
    url: 'https://theblock.co/rss.xml',
    kind: 'rss',
    tier: 'media',
  },
  {
    source: 'binance.com',
    url: 'https://www.binance.com/en/support/announcement',
    kind: 'html',
    tier: 'media',
    topicHint: 'recent_developments',
  },
];

const MEDIA_TARGETS_BY_DOMAIN: Record<string, OpenResearchSourceTarget> = {
  'coindesk.com': GENERAL_MEDIA_TARGETS[0],
  'decrypt.co': GENERAL_MEDIA_TARGETS[1],
  'blockworks.co': GENERAL_MEDIA_TARGETS[2],
  'theblock.co': GENERAL_MEDIA_TARGETS[3],
  'binance.com': GENERAL_MEDIA_TARGETS[4],
  'bitcoinmagazine.com': {
    source: 'bitcoinmagazine.com',
    url: 'https://bitcoinmagazine.com/.rss/full/',
    kind: 'rss',
    tier: 'media',
  },
};

@Injectable()
export class OpenResearchService {
  readonly moduleName = 'open_research';
  private readonly logger = new Logger(OpenResearchService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(input: OpenResearchInput): Promise<OpenResearchSnapshot> {
    const topicLimit =
      input.depth === 'heavy' ? 8 : input.depth === 'standard' ? 6 : 4;
    const goalLimit = input.depth === 'heavy' ? 6 : 4;
    const itemLimit =
      input.depth === 'heavy' ? 12 : input.depth === 'standard' ? 8 : 5;
    const takeawayLimit = input.depth === 'heavy' ? 5 : 4;
    const topics = this.unique(input.topics).slice(0, topicLimit);
    const goals = this.unique(input.goals).slice(0, goalLimit);
    const queries = this.buildQueries(input, topics);

    const [officialItems, rootDataItems, mediaItems] = await Promise.all([
      this.collectOfficialItems(input, queries),
      this.collectRootDataItems(input, queries),
      this.collectMediaItems(input, queries),
    ]);

    const baseItems = this.uniqueItems([
      ...officialItems,
      ...rootDataItems,
      ...mediaItems,
    ]);

    const duckItems = this.shouldUseDuckDuckGo(input.depth, baseItems.length, itemLimit)
      ? await this.collectDuckDuckGoItems(queries, input.depth)
      : [];

    const items = this.rankItems(
      this.uniqueItems([...baseItems, ...duckItems]),
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
    const assetTerms = this.buildAssetTerms(input.identity);
    const canonicalAsset = assetTerms[0] ?? input.identity.symbol;
    const normalizedQuery = this.normalizeQuery(input.query, input.identity);
    const focusedQueries = this.buildFocusedQueries(
      input,
      topics,
      canonicalAsset,
    );
    const queries = [
      `${canonicalAsset} ${normalizedQuery}`.trim(),
      ...assetTerms
        .slice(1)
        .map((term) => `${term} ${normalizedQuery}`.trim()),
      ...focusedQueries,
    ];

    const topicQueryLimit =
      input.depth === 'heavy' ? 6 : input.depth === 'standard' ? 4 : 2;
    const goalQueryLimit = input.depth === 'heavy' ? 4 : 2;
    const sourceQueryLimit = input.depth === 'heavy' ? 6 : 4;

    for (const topic of topics.slice(0, topicQueryLimit)) {
      queries.push(`${canonicalAsset} ${this.normalizeTopic(topic)}`.trim());
    }

    for (const goal of input.goals.slice(0, goalQueryLimit)) {
      queries.push(`${canonicalAsset} ${this.normalizeTopic(goal)}`.trim());
    }

    for (const source of input.preferredSources.slice(0, sourceQueryLimit)) {
      const site = this.normalizePreferredSource(source);
      if (!site) {
        continue;
      }
      queries.push(`${canonicalAsset} ${normalizedQuery} site:${site}`.trim());
      if (topics[0]) {
        queries.push(
          `${canonicalAsset} ${this.normalizeTopic(topics[0])} site:${site}`.trim(),
        );
      }
      if (focusedQueries[0]) {
        queries.push(`${focusedQueries[0]} site:${site}`.trim());
      }
    }

    return this.unique(
      queries
        .map((query) => query.replace(/\s+/g, ' ').trim())
        .filter((query) => query.length > 0),
    ).slice(
      0,
      input.depth === 'heavy' ? 12 : input.depth === 'standard' ? 8 : 4,
    );
  }

  private async collectOfficialItems(
    input: OpenResearchInput,
    queries: string[],
  ): Promise<OpenResearchCandidate[]> {
    const targets = this.buildOfficialTargets(input);
    const items = await this.collectSourceTargets(targets, queries, input.identity);
    return items.slice(0, input.depth === 'heavy' ? 10 : 6);
  }

  private async collectMediaItems(
    input: OpenResearchInput,
    queries: string[],
  ): Promise<OpenResearchCandidate[]> {
    const targets = this.buildMediaTargets(input);
    const items = await this.collectSourceTargets(targets, queries, input.identity);
    return items.slice(0, input.depth === 'heavy' ? 8 : 5);
  }

  private async collectSourceTargets(
    targets: OpenResearchSourceTarget[],
    queries: string[],
    identity: AnalyzeIdentity,
  ): Promise<OpenResearchCandidate[]> {
    const results = await Promise.all(
      targets.map((target) => this.fetchSourceTarget(target, queries, identity)),
    );
    return this.uniqueItems(results.flat());
  }

  private buildOfficialTargets(
    input: OpenResearchInput,
  ): OpenResearchSourceTarget[] {
    const symbol = input.identity.symbol.trim().toUpperCase();
    const text = `${input.query} ${input.topics.join(' ')} ${input.goals.join(' ')}`.toLowerCase();
    const wantsL2 =
      text.includes('l2') || text.includes('layer 2') || text.includes('二层');
    const targets: OpenResearchSourceTarget[] = [];

    if (symbol === 'ETH') {
      targets.push(
        {
          source: 'blog.ethereum.org',
          url: 'https://blog.ethereum.org/feed.xml',
          kind: 'rss',
          tier: 'official',
          topicHint: 'recent_developments',
        },
        {
          source: 'ethereum.org',
          url: 'https://ethereum.org/en/blog/',
          kind: 'html',
          tier: 'official',
          topicHint: 'recent_developments',
        },
      );
    }

    if (symbol === 'SOL') {
      targets.push(
        {
          source: 'solana.com',
          url: 'https://solana.com/news?format=rss',
          kind: 'rss',
          tier: 'official',
          topicHint: 'recent_developments',
        },
        {
          source: 'solana.com',
          url: 'https://solana.com/news',
          kind: 'html',
          tier: 'official',
          topicHint: 'recent_developments',
        },
      );
    }

    if (symbol === 'BTC') {
      targets.push(
        {
          source: 'bitcoin.org',
          url: 'https://bitcoin.org/en/rss/blog.xml',
          kind: 'rss',
          tier: 'official',
          topicHint: 'recent_developments',
        },
        {
          source: 'bitcoin.org',
          url: 'https://bitcoin.org/en/blog',
          kind: 'html',
          tier: 'official',
          topicHint: 'recent_developments',
        },
        {
          source: 'bitcoincore.org',
          url: 'https://bitcoincore.org/en/releases/',
          kind: 'html',
          tier: 'official',
          topicHint: 'recent_developments',
        },
      );
    }

    if (symbol === 'ETH' || wantsL2) {
      targets.push(
        {
          source: 'l2beat.com',
          url: 'https://l2beat.com/scaling/summary',
          kind: 'html',
          tier: 'official',
          topicHint: 'layer2_progress',
        },
        {
          source: 'optimism.io',
          url: 'https://www.optimism.io/blog',
          kind: 'html',
          tier: 'official',
          topicHint: 'layer2_progress',
        },
        {
          source: 'blog.arbitrum.io',
          url: 'https://blog.arbitrum.io/feed',
          kind: 'rss',
          tier: 'official',
          topicHint: 'layer2_progress',
        },
      );
    }

    for (const source of input.preferredSources) {
      const target = this.mapPreferredSourceToTarget(source);
      if (target && target.tier === 'official') {
        targets.push(target);
      }
    }

    return this.uniqueTargets(targets);
  }

  private buildMediaTargets(input: OpenResearchInput): OpenResearchSourceTarget[] {
    const symbol = input.identity.symbol.trim().toUpperCase();
    const targets = [...GENERAL_MEDIA_TARGETS];

    if (symbol === 'BTC') {
      targets.push(MEDIA_TARGETS_BY_DOMAIN['bitcoinmagazine.com']);
    }

    for (const source of input.preferredSources) {
      const target = this.mapPreferredSourceToTarget(source);
      if (target && target.tier === 'media') {
        targets.push(target);
      }
    }

    return this.uniqueTargets(targets).slice(0, 6);
  }

  private mapPreferredSourceToTarget(
    source: string,
  ): OpenResearchSourceTarget | null {
    const domain = this.normalizePreferredSource(source);
    if (!domain || domain === 'rootdata.com') {
      return null;
    }

    if (domain in MEDIA_TARGETS_BY_DOMAIN) {
      return MEDIA_TARGETS_BY_DOMAIN[domain];
    }

    if (domain === 'blog.ethereum.org') {
      return {
        source: domain,
        url: 'https://blog.ethereum.org/feed.xml',
        kind: 'rss',
        tier: 'official',
        topicHint: 'recent_developments',
      };
    }
    if (domain === 'ethereum.org') {
      return {
        source: domain,
        url: 'https://ethereum.org/en/blog/',
        kind: 'html',
        tier: 'official',
        topicHint: 'recent_developments',
      };
    }
    if (domain === 'l2beat.com') {
      return {
        source: domain,
        url: 'https://l2beat.com/scaling/summary',
        kind: 'html',
        tier: 'official',
        topicHint: 'layer2_progress',
      };
    }
    if (domain === 'optimism.io') {
      return {
        source: domain,
        url: 'https://www.optimism.io/blog',
        kind: 'html',
        tier: 'official',
        topicHint: 'layer2_progress',
      };
    }
    if (domain === 'arbitrum.io' || domain === 'blog.arbitrum.io') {
      return {
        source: 'blog.arbitrum.io',
        url: 'https://blog.arbitrum.io/feed',
        kind: 'rss',
        tier: 'official',
        topicHint: 'layer2_progress',
      };
    }
    if (
      domain === 'solana.com' ||
      domain === 'solana.org' ||
      domain === 'solana.foundation'
    ) {
      return {
        source: 'solana.com',
        url: 'https://solana.com/news?format=rss',
        kind: 'rss',
        tier: 'official',
        topicHint: 'recent_developments',
      };
    }
    if (domain === 'bitcoin.org') {
      return {
        source: 'bitcoin.org',
        url: 'https://bitcoin.org/en/rss/blog.xml',
        kind: 'rss',
        tier: 'official',
        topicHint: 'recent_developments',
      };
    }
    if (domain === 'bitcoincore.org') {
      return {
        source: 'bitcoincore.org',
        url: 'https://bitcoincore.org/en/releases/',
        kind: 'html',
        tier: 'official',
        topicHint: 'recent_developments',
      };
    }

    return null;
  }

  private async fetchSourceTarget(
    target: OpenResearchSourceTarget,
    queries: string[],
    identity: AnalyzeIdentity,
  ): Promise<OpenResearchCandidate[]> {
    const body = await this.fetchDocument(
      target.url,
      target.kind === 'rss'
        ? 'application/rss+xml,application/atom+xml,text/xml'
        : 'text/html,application/xhtml+xml',
    );
    if (!body) {
      return [];
    }

    const rawItems =
      target.kind === 'rss'
        ? this.parseFeedItems(body, target.url, target.source)
        : this.parseHtmlItems(body, target.url, target.source);

    return rawItems
      .map((item) =>
        this.toCandidateItem(item, queries, identity, target.tier, target.topicHint),
      )
      .filter((item): item is OpenResearchCandidate => item !== null)
      .slice(0, target.tier === 'official' ? 5 : 4);
  }

  private async fetchDocument(url: string, accept: string): Promise<string | null> {
    const timeoutMs = Number(process.env.OPEN_RESEARCH_TIMEOUT_MS ?? 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        this.logger.warn(
          `Open research source failed (${response.status}) for ${url}`,
        );
        return null;
      }
      return await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Open research source unavailable for ${url}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseFeedItems(
    xml: string,
    feedUrl: string,
    source: string,
  ): OpenResearchItem[] {
    const blocks = [
      ...this.matchBlocks(xml, 'item'),
      ...this.matchBlocks(xml, 'entry'),
    ];

    return blocks
      .map((block) => {
        const title = this.cleanHtml(this.extractXmlValue(block, ['title']) ?? '');
        const link = this.extractFeedLink(block, feedUrl);
        const snippet = this.cleanHtml(
          this.extractXmlValue(block, [
            'description',
            'summary',
            'content:encoded',
            'content',
          ]) ?? '',
        );
        const publishedAt =
          this.normalizeDate(
            this.extractXmlValue(block, ['pubDate', 'published', 'updated']),
          ) ?? null;

        if (!title || !link) {
          return null;
        }

        return {
          title,
          url: link,
          source,
          snippet: snippet || null,
          publishedAt,
          topic: 'general_research',
          relevanceScore: 0,
        };
      })
      .filter((item): item is OpenResearchItem => item !== null);
  }

  private parseHtmlItems(
    html: string,
    pageUrl: string,
    source: string,
  ): OpenResearchItem[] {
    const items: OpenResearchItem[] = [];
    const regex = /<a\b([^>]*)href=(['"])([^"'#]+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
    let match = regex.exec(html);

    while (match) {
      const href = this.decodeHtml(match[3] ?? '').trim();
      const inner = match[5] ?? '';
      const title = this.cleanHtml(inner);
      const url = this.normalizeLink(href, pageUrl);

      if (!title || !url) {
        match = regex.exec(html);
        continue;
      }
      if (title.length < 8 || this.isLikelyNavigationTitle(title)) {
        match = regex.exec(html);
        continue;
      }
      if (!this.isSameSourceUrl(url, source) || this.isIndexPage(url, pageUrl)) {
        match = regex.exec(html);
        continue;
      }

      items.push({
        title,
        url,
        source,
        snippet: null,
        publishedAt: null,
        topic: 'general_research',
        relevanceScore: 0,
      });
      match = regex.exec(html);
    }

    return this.uniqueItems(items).slice(0, 24);
  }

  private toCandidateItem(
    item: OpenResearchItem,
    queries: string[],
    identity: AnalyzeIdentity,
    tier: OpenResearchSourceTier,
    topicHint?: string,
  ): OpenResearchCandidate | null {
    const match = this.findBestQuery(item.title, item.snippet ?? '', queries);
    const assetBoost = this.computeAssetBoost(identity, item.title, item.snippet ?? '');
    const topicBoost = topicHint === 'layer2_progress' ? 0.08 : topicHint ? 0.05 : 0;
    const tierBoost = tier === 'official' ? 0.18 : 0.08;
    const score = Math.min(
      1,
      Number((match.score + assetBoost + topicBoost + tierBoost).toFixed(2)),
    );
    const threshold = tier === 'official' ? 0.34 : 0.38;

    if (score < threshold) {
      return null;
    }

    return {
      ...item,
      topic: topicHint ?? this.detectTopic(match.query, item.title, item.snippet ?? ''),
      relevanceScore: score,
      tier,
    };
  }

  private async collectRootDataItems(
    input: OpenResearchInput,
    queries: string[],
  ): Promise<OpenResearchCandidate[]> {
    const apiKey = this.getRootDataApiKey();
    if (!apiKey) {
      return [];
    }

    const projectId = await this.searchRootDataProjectId(input.identity.symbol, apiKey);
    if (!projectId) {
      return [];
    }

    const [itemBody, fundraisingBody] = await Promise.all([
      this.fetchRootData(
        process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item',
        {
          project_id: projectId,
          include_team: 1,
          include_investors: 1,
        },
        apiKey,
        'open_research_item',
      ),
      this.fetchRootData(
        process.env.ROOTDATA_FUNDRAISING_URL ?? 'https://api.rootdata.com/open/get_fac',
        {
          project_id: projectId,
          page: 1,
          size: 10,
        },
        apiKey,
        'open_research_fundraising',
      ),
    ]);

    const item = this.extractItemNode(itemBody);
    const fundraisingRows = this.extractRows(fundraisingBody);
    const results: OpenResearchCandidate[] = [];

    if (item) {
      const name =
        this.toString(item.project_name ?? item.name) ?? input.identity.symbol;
      const oneLiner = this.toString(item.one_liner ?? item.introduce);
      const tags = this.toStringArray(item.tags ?? item.tag).slice(0, 4);
      const investors = this.extractInvestorNames(item).slice(0, 4);
      const snippet = [
        oneLiner,
        tags.length > 0 ? `Tags: ${tags.join(', ')}` : null,
        investors.length > 0 ? `Backers: ${investors.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
      const bestQuery = this.findBestQuery(name, snippet, queries).query;

      results.push({
        title: `${name} project profile on RootData`,
        url:
          this.toString(item.rootdataurl ?? item.rootdata_url) ??
          (process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item'),
        source: 'rootdata.com',
        snippet: snippet || null,
        publishedAt: null,
        topic: this.detectTopic(bestQuery, name, snippet),
        relevanceScore: Math.min(
          1,
          Number(
            (
              this.findBestQuery(name, snippet, queries).score +
              0.24
            ).toFixed(2),
          ),
        ),
        tier: 'rootdata',
      });
    }

    if (fundraisingRows.length > 0) {
      const latest = fundraisingRows[0] ?? {};
      const round = this.toString(
        latest.round ?? latest.stage ?? latest.round_name,
      );
      const amount = this.toNumber(
        latest.amount ??
          latest.amount_usd ??
          latest.funding_amount ??
          latest.funding_amount_usd,
      );
      const investors = this.toStringArray(
        latest.investors ?? latest.investor_list ?? latest.investor,
      ).slice(0, 4);
      const publishedAt =
        this.normalizeDate(
          this.toString(
            latest.published_time ?? latest.published_at ?? latest.date,
          ),
        ) ?? null;
      const snippet = [
        round ? `Latest round: ${round}` : null,
        amount !== null ? `Amount: $${this.formatCompactNumber(amount)}` : null,
        investors.length > 0 ? `Investors: ${investors.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
      const name =
        item
          ? this.toString(item.project_name ?? item.name) ?? input.identity.symbol
          : input.identity.symbol;
      const bestQuery = this.findBestQuery(name, snippet, queries).query;

      results.push({
        title: `${name} fundraising snapshot on RootData`,
        url:
          item &&
          (this.toString(item.rootdataurl ?? item.rootdata_url) ??
            process.env.ROOTDATA_ITEM_URL)
            ? (this.toString(item.rootdataurl ?? item.rootdata_url) ??
              (process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item'))
            : process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item',
        source: 'rootdata.com',
        snippet: snippet || null,
        publishedAt,
        topic: this.detectTopic(bestQuery, name, snippet),
        relevanceScore: Math.min(
          1,
          Number(
            (
              this.findBestQuery(name, snippet, queries).score +
              0.22
            ).toFixed(2),
          ),
        ),
        tier: 'rootdata',
      });
    }

    return this.uniqueItems(results).slice(0, 3);
  }

  private shouldUseDuckDuckGo(
    depth: OpenResearchInput['depth'],
    currentCount: number,
    itemLimit: number,
  ): boolean {
    if (!this.isEnabled(process.env.OPEN_RESEARCH_ENABLE_DDG ?? '1')) {
      return false;
    }
    if (depth === 'heavy') {
      return currentCount < itemLimit;
    }
    return currentCount < Math.min(itemLimit, 5);
  }

  private async collectDuckDuckGoItems(
    queries: string[],
    depth: OpenResearchInput['depth'],
  ): Promise<OpenResearchCandidate[]> {
    const results = await Promise.all(
      queries.map((query) => this.searchOpenWeb(query, depth)),
    );

    return this.uniqueItems(results.flat()).map((item) => ({
      ...item,
      relevanceScore: Math.min(1, Number((item.relevanceScore + 0.02).toFixed(2))),
      tier: 'duckduckgo' as const,
    }));
  }

  private async searchOpenWeb(
    query: string,
    depth: OpenResearchInput['depth'],
  ): Promise<OpenResearchItem[]> {
    const htmlItems = await this.searchDuckDuckGoHtml(query);
    if (htmlItems.length > 0 && depth === 'light') {
      return htmlItems;
    }

    const liteItems =
      depth === 'light' && htmlItems.length > 0
        ? []
        : await this.searchDuckDuckGoLite(query);

    return this.uniqueItems([...htmlItems, ...liteItems]);
  }

  private async searchDuckDuckGoHtml(query: string): Promise<OpenResearchItem[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    return this.fetchSearchPage(url, query, this.parseDuckDuckGoHtmlResults);
  }

  private async searchDuckDuckGoLite(query: string): Promise<OpenResearchItem[]> {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    return this.fetchSearchPage(url, query, this.parseDuckDuckGoLiteResults);
  }

  private async fetchSearchPage(
    url: string,
    query: string,
    parser: (html: string, query: string) => OpenResearchItem[],
  ): Promise<OpenResearchItem[]> {
    const timeoutMs = Number(process.env.OPEN_RESEARCH_TIMEOUT_MS ?? 8000);
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
      return parser.call(this, html, query);
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

  private parseDuckDuckGoHtmlResults(
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

  private parseDuckDuckGoLiteResults(
    html: string,
    query: string,
  ): OpenResearchItem[] {
    const normalized = html.replace(/\n/g, ' ');
    const regex =
      /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>(.*?)<\/a>(?:[\s\S]*?<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>)?/gi;
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

  private matchBlocks(xml: string, tag: string): string[] {
    const escaped = this.escapeRegex(tag);
    const regex = new RegExp(
      `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
      'gi',
    );
    const blocks: string[] = [];
    let match = regex.exec(xml);
    while (match) {
      blocks.push(match[0]);
      match = regex.exec(xml);
    }
    return blocks;
  }

  private extractXmlValue(block: string, tags: string[]): string | null {
    for (const tag of tags) {
      const escaped = this.escapeRegex(tag);
      const regex = new RegExp(
        `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
        'i',
      );
      const match = regex.exec(block);
      if (!match?.[1]) {
        continue;
      }
      return this.decodeHtml(
        match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim(),
      );
    }

    return null;
  }

  private extractFeedLink(block: string, baseUrl: string): string | null {
    const linkValue = this.extractXmlValue(block, ['link']);
    if (linkValue?.trim()) {
      return this.normalizeLink(linkValue.trim(), baseUrl);
    }

    const atomMatch = /<link\b[^>]*href=(['"])(.*?)\1[^>]*\/?>/i.exec(block);
    if (atomMatch?.[2]) {
      return this.normalizeLink(this.decodeHtml(atomMatch[2]), baseUrl);
    }

    return null;
  }

  private findBestQuery(
    title: string,
    snippet: string,
    queries: string[],
  ): { query: string; score: number } {
    let bestQuery = queries[0] ?? '';
    let bestScore = 0.25;

    for (const query of queries) {
      const score = this.computeRelevance(query, title, snippet);
      if (score > bestScore) {
        bestScore = score;
        bestQuery = query;
      }
    }

    return { query: bestQuery, score: bestScore };
  }

  private computeAssetBoost(
    identity: AnalyzeIdentity,
    title: string,
    snippet: string,
  ): number {
    const haystack = `${title} ${snippet}`.toLowerCase();
    const terms = this.unique([
      ...this.buildAssetTerms(identity),
      identity.chain,
      identity.symbol,
    ]).map((value) => value.toLowerCase());
    let score = 0;

    for (const term of terms) {
      if (!term || term.length < 2 || !haystack.includes(term)) {
        continue;
      }
      score += title.toLowerCase().includes(term) ? 0.09 : 0.04;
    }

    return Math.min(0.2, Number(score.toFixed(2)));
  }

  private async searchRootDataProjectId(
    symbol: string,
    apiKey: string,
  ): Promise<number | null> {
    const body = await this.fetchRootData(
      process.env.ROOTDATA_SEARCH_URL ?? 'https://api.rootdata.com/open/ser_inv',
      {
        query: symbol,
        page: 1,
        size: 10,
      },
      apiKey,
      'open_research_search',
    );
    if (!body || typeof body !== 'object') {
      return null;
    }

    const rows = this.extractRows(body);
    const projectRow =
      rows.find((row) => this.toNumber(row.type) === 1) ?? rows[0];
    if (!projectRow) {
      return null;
    }

    const id =
      this.toNumber(projectRow.project_id) ?? this.toNumber(projectRow.id);
    return id !== null ? Math.round(id) : null;
  }

  private async fetchRootData(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    label: string,
  ): Promise<unknown> {
    const timeoutMs = this.getRootDataTimeoutMs();
    const attempts = Math.max(
      1,
      Number(process.env.ROOTDATA_RETRY_ATTEMPTS ?? 3),
    );

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            apikey: apiKey,
            language: process.env.ROOTDATA_LANGUAGE ?? 'en',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          this.logger.warn(`RootData ${label} fetch failed (${response.status}).`);
          return null;
        }

        return (await response.json()) as
          | RootDataSearchResponse
          | RootDataItemResponse
          | RootDataFundraisingResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          attempt < attempts &&
          (message.includes('aborted') || message.includes('fetch failed'));
        this.logger.warn(
          `RootData ${label} unavailable${retryable ? ` (attempt ${attempt}/${attempts})` : ''}: ${message}`,
        );
        if (!retryable) {
          return null;
        }
        await this.delay(300 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  }

  private getRootDataApiKey(): string | null {
    const apiKey =
      process.env.ROOTDATA_ACCESS_KEY ?? process.env.ROOTDATA_API_KEY;
    return apiKey?.trim() ? apiKey.trim() : null;
  }

  private getRootDataTimeoutMs(): number {
    const configured = Number(process.env.ROOTDATA_TIMEOUT_MS ?? 8000);
    return Number.isFinite(configured) ? Math.max(configured, 12000) : 12000;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractRows(value: unknown): Array<Record<string, unknown>> {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const obj = value as Record<string, unknown>;
    const candidates = [obj.data, obj.result, obj.list, obj.items];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row && typeof row === 'object'),
        );
      }
      if (candidate && typeof candidate === 'object') {
        const rows = (candidate as Record<string, unknown>).rows;
        if (Array.isArray(rows)) {
          return rows.filter(
            (row): row is Record<string, unknown> =>
              Boolean(row && typeof row === 'object'),
          );
        }
      }
    }
    return [];
  }

  private extractItemNode(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const obj = value as Record<string, unknown>;
    const candidates = [obj.item, obj.project, obj.data, obj.result];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const node = candidate as Record<string, unknown>;
        if ('project_name' in node || 'name' in node || 'introduce' in node) {
          return node;
        }
        if (node.item && typeof node.item === 'object') {
          return node.item as Record<string, unknown>;
        }
        if (node.project && typeof node.project === 'object') {
          return node.project as Record<string, unknown>;
        }
      }
    }

    return null;
  }

  private extractInvestorNames(item: Record<string, unknown>): string[] {
    const investors = this.toArray(item.investors ?? item.investor_list);
    return investors
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const obj = row as Record<string, unknown>;
        return this.toString(obj.name ?? obj.investor_name);
      })
      .filter((name): name is string => Boolean(name));
  }

  private rankItems(
    items: Array<OpenResearchItem | OpenResearchCandidate>,
    topics: string[],
  ): OpenResearchItem[] {
    return [...items]
      .sort((left, right) => {
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
      })
      .map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        snippet: item.snippet,
        publishedAt: item.publishedAt,
        topic: item.topic,
        relevanceScore: item.relevanceScore,
      }));
  }

  private uniqueItems<T extends OpenResearchItem>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
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

  private uniqueTargets(
    items: OpenResearchSourceTarget[],
  ): OpenResearchSourceTarget[] {
    const seen = new Set<string>();
    const result: OpenResearchSourceTarget[] = [];
    for (const item of items) {
      const key = `${item.source}::${item.url}`;
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

  private buildAssetTerms(identity: AnalyzeIdentity): string[] {
    const symbol = identity.symbol.trim().toUpperCase();
    if (symbol === 'ETH') {
      return ['ethereum', 'eth', 'ether'];
    }
    if (symbol === 'BTC') {
      return ['bitcoin', 'btc'];
    }
    if (symbol === 'SOL') {
      return ['solana', 'sol'];
    }
    return [identity.symbol.trim().toLowerCase()];
  }

  private normalizeQuery(query: string, identity: AnalyzeIdentity): string {
    return query
      .replace(new RegExp(identity.symbol, 'ig'), ' ')
      .replace(/[，。！？、,.!?/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private normalizeTopic(value: string): string {
    return value
      .replace(/[，。！？、,.!?/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private buildFocusedQueries(
    input: OpenResearchInput,
    topics: string[],
    canonicalAsset: string,
  ): string[] {
    const raw = `${input.query} ${topics.join(' ')} ${input.goals.join(' ')}`.toLowerCase();
    const queries: string[] = [];

    if (
      raw.includes('l2') ||
      raw.includes('layer 2') ||
      raw.includes('二层')
    ) {
      queries.push(
        `${canonicalAsset} layer 2 progress`,
        `${canonicalAsset} l2 ecosystem`,
        `${canonicalAsset} scaling roadmap`,
        `${canonicalAsset} rollup adoption`,
      );
    }

    if (
      raw.includes('最近') ||
      raw.includes('最新') ||
      raw.includes('recent') ||
      raw.includes('developments') ||
      raw.includes('progress')
    ) {
      queries.push(
        `${canonicalAsset} recent developments`,
        `${canonicalAsset} latest ecosystem progress`,
        `${canonicalAsset} upgrade roadmap`,
      );
    }

    if (
      raw.includes('驱动') ||
      raw.includes('driver') ||
      raw.includes('drivers') ||
      raw.includes('why')
    ) {
      queries.push(
        `${canonicalAsset} price drivers`,
        `${canonicalAsset} catalysts`,
      );
    }

    if (raw.includes('风险') || raw.includes('risk')) {
      queries.push(
        `${canonicalAsset} biggest risks`,
        `${canonicalAsset} concerns adoption liquidity regulation`,
      );
    }

    if (
      raw.includes('基本面') ||
      raw.includes('fundamental') ||
      raw.includes('情绪') ||
      raw.includes('sentiment')
    ) {
      queries.push(
        `${canonicalAsset} fundamentals adoption activity`,
        `${canonicalAsset} sentiment speculation`,
      );
    }

    if (
      raw.includes('投资') ||
      raw.includes('invest') ||
      raw.includes('investable')
    ) {
      queries.push(
        `${canonicalAsset} investment case`,
        `${canonicalAsset} adoption growth usage`,
      );
    }

    return this.unique(queries);
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

  private normalizeLink(url: string, baseUrl: string): string {
    if (
      !url ||
      url.startsWith('#') ||
      url.startsWith('javascript:') ||
      url.startsWith('mailto:')
    ) {
      return '';
    }

    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return '';
    }
  }

  private extractSource(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'open_web';
    }
  }

  private isSameSourceUrl(url: string, source: string): boolean {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      const normalized = source.replace(/^www\./, '');
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    } catch {
      return false;
    }
  }

  private isIndexPage(url: string, pageUrl: string): boolean {
    try {
      const parsed = new URL(url);
      const base = new URL(pageUrl);
      return (
        parsed.origin === base.origin &&
        parsed.pathname.replace(/\/+$/, '') === base.pathname.replace(/\/+$/, '')
      );
    } catch {
      return false;
    }
  }

  private isLikelyNavigationTitle(title: string): boolean {
    const normalized = title.trim().toLowerCase();
    return [
      'home',
      'blog',
      'news',
      'about',
      'docs',
      'careers',
      'contact',
      'ecosystem',
      'developers',
      'community',
      'learn more',
      'read more',
      'see all',
      'view all',
    ].includes(normalized);
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

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeDate(value: string | null | undefined): string | null {
    if (!value?.trim()) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  private formatCompactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (abs >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    }
    if (abs >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toFixed(0);
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
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private toString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.toString(item))
        .filter((item): item is string => Boolean(item));
    }
    if (typeof value === 'string') {
      return value
        .split(/[;,|/]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/[$,%\s,]/g, '');
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private isEnabled(value: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
}

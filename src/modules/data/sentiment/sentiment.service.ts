import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  SentimentSnapshot,
} from '../../../data/contracts/analyze-contracts';

type SantimentMetric = {
  datetime: string;
  value: number;
};

type SantimentResponse = {
  data?: {
    getMetric?: {
      timeseriesData?: SantimentMetric[];
    };
  };
  errors?: Array<{ message: string }>;
};

type SentimentMetrics = {
  socialVolume: number | null;
  socialDominance: number | null;
  sentimentPositive: number | null;
  sentimentNegative: number | null;
  sentimentBalanced: number | null;
  devActivity: number | null;
  githubActivity: number | null;
};

@Injectable()
export class SentimentService {
  readonly moduleName = 'sentiment';
  private readonly logger = new Logger(SentimentService.name);

  getStatus() {
    return { module: this.moduleName, state: 'ready' as const };
  }

  async fetchSentiment(identity: AnalyzeIdentity): Promise<SentimentSnapshot> {
    const metrics = await this.fetchSantimentMetrics(identity);

    if (!metrics) {
      return this.buildUnavailableSnapshot();
    }

    const sentimentScore = this.calculateSentimentScore(metrics);
    const signal = this.determineSignal(metrics, sentimentScore);

    const degradeReason = this.getDegradeReason(metrics);

    return {
      socialVolume: metrics.socialVolume,
      socialDominance: metrics.socialDominance,
      sentimentPositive: metrics.sentimentPositive,
      sentimentNegative: metrics.sentimentNegative,
      sentimentBalanced: metrics.sentimentBalanced,
      sentimentScore,
      devActivity: metrics.devActivity,
      githubActivity: metrics.githubActivity,
      signal,
      asOf: new Date().toISOString(),
      sourceUsed: 'santiment',
      degraded: Boolean(degradeReason),
      degradeReason,
    };
  }

  private async fetchSantimentMetrics(
    identity: AnalyzeIdentity,
  ): Promise<SentimentMetrics | null> {
    const slug = this.resolveSlug(identity);
    if (!slug) {
      this.logger.warn(
        `Cannot resolve Santiment slug for ${identity.symbol} on ${identity.chain}`,
      );
      return null;
    }

    const now = new Date();
    const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // SANBASE PRO restricts social/sentiment metrics: most recent ~30 days are unavailable.
    // Query a 30-day window ending 31 days ago to stay within the allowed range.
    const restrictedTo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const restrictedFrom = new Date(restrictedTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      socialVolume,
      socialDominance,
      sentimentPositive,
      sentimentNegative,
      sentimentBalanced,
      devActivity,
      githubActivity,
    ] = await Promise.all([
      this.fetchMetric(slug, 'social_volume_total', restrictedFrom, restrictedTo),
      this.fetchMetric(slug, 'social_dominance_total', restrictedFrom, restrictedTo),
      this.fetchMetric(slug, 'sentiment_positive_total', restrictedFrom, restrictedTo),
      this.fetchMetric(slug, 'sentiment_negative_total', restrictedFrom, restrictedTo),
      this.fetchMetric(slug, 'sentiment_balance_total', restrictedFrom, restrictedTo),
      this.fetchMetric(slug, 'dev_activity', from24h, now),
      this.fetchMetric(slug, 'github_activity', from24h, now),
    ]);

    return {
      socialVolume,
      socialDominance,
      sentimentPositive,
      sentimentNegative,
      sentimentBalanced,
      devActivity,
      githubActivity,
    };
  }

  private async fetchMetric(
    slug: string,
    metric: string,
    from: Date,
    to: Date,
  ): Promise<number | null> {
    const query = `
      query {
        getMetric(metric: "${metric}") {
          timeseriesData(
            slug: "${slug}"
            from: "${from.toISOString()}"
            to: "${to.toISOString()}"
            interval: "1d"
          ) {
            datetime
            value
          }
        }
      }
    `;

    const response = await this.executeGraphQL(query);
    if (!response?.data?.getMetric?.timeseriesData) {
      return null;
    }

    const data = response.data.getMetric.timeseriesData;
    if (data.length === 0) {
      return null;
    }

    const latest = data[data.length - 1];
    return this.toNullableNumber(latest.value);
  }

  private async executeGraphQL(
    query: string,
  ): Promise<SantimentResponse | null> {
    const apiKey = process.env.SANTIMENT_ACCESS_KEY?.trim();
    if (!apiKey) {
      this.logger.warn('SANTIMENT_ACCESS_KEY not configured');
      return null;
    }

    const url =
      process.env.SANTIMENT_GRAPHQL_URL?.trim() ||
      'https://api.santiment.net/graphql';
    const timeoutMs = Number(process.env.SANTIMENT_TIMEOUT_MS ?? 7000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Apikey ${apiKey}`,
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Santiment request failed (${response.status}) for query`,
        );
        return null;
      }

      const body = (await response.json()) as SantimentResponse;

      if (body.errors && body.errors.length > 0) {
        this.logger.warn(
          `Santiment GraphQL errors: ${body.errors.map((e) => e.message).join(', ')}`,
        );
        return null;
      }

      return body;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Santiment request failed: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveSlug(identity: AnalyzeIdentity): string | null {
    const symbol = identity.symbol.toLowerCase();
    const slugMap: Record<string, string> = {
      btc: 'bitcoin',
      eth: 'ethereum',
      usdt: 'tether',
      bnb: 'binance-coin',
      sol: 'solana',
      usdc: 'usd-coin',
      xrp: 'ripple',
      ada: 'cardano',
      avax: 'avalanche',
      doge: 'dogecoin',
      dot: 'polkadot',
      matic: 'polygon',
      link: 'chainlink',
      uni: 'uniswap',
      atom: 'cosmos',
      etc: 'ethereum-classic',
      xlm: 'stellar',
      ltc: 'litecoin',
      bch: 'bitcoin-cash',
      near: 'near-protocol',
    };

    return slugMap[symbol] || symbol;
  }

  private calculateSentimentScore(
    metrics: SentimentMetrics,
  ): number | null {
    if (
      metrics.sentimentPositive === null &&
      metrics.sentimentNegative === null &&
      metrics.sentimentBalanced === null
    ) {
      return null;
    }

    const positive = metrics.sentimentPositive ?? 0;
    const negative = metrics.sentimentNegative ?? 0;
    const balanced = metrics.sentimentBalanced ?? 0;

    const total = positive + negative + balanced;
    if (total === 0) {
      return 0;
    }

    return ((positive - negative) / total) * 100;
  }

  private determineSignal(
    metrics: SentimentMetrics,
    sentimentScore: number | null,
  ): 'bullish' | 'bearish' | 'neutral' {
    if (sentimentScore === null) {
      return 'neutral';
    }

    const socialVolume = metrics.socialVolume ?? 0;
    const devActivity = metrics.devActivity ?? 0;

    if (sentimentScore > 20 && socialVolume > 100) {
      return 'bullish';
    }

    if (sentimentScore < -20 && socialVolume > 100) {
      return 'bearish';
    }

    if (devActivity > 50) {
      return 'bullish';
    }

    return 'neutral';
  }

  private getDegradeReason(metrics: SentimentMetrics): string | undefined {
    const hasAnySentiment =
      metrics.sentimentPositive !== null ||
      metrics.sentimentNegative !== null ||
      metrics.sentimentBalanced !== null;

    if (!hasAnySentiment) {
      return 'SENTIMENT_DATA_MISSING';
    }

    if (metrics.socialVolume === null) {
      return 'SOCIAL_VOLUME_MISSING';
    }

    return undefined;
  }

  private buildUnavailableSnapshot(): SentimentSnapshot {
    return {
      socialVolume: null,
      socialDominance: null,
      sentimentPositive: null,
      sentimentNegative: null,
      sentimentBalanced: null,
      sentimentScore: null,
      devActivity: null,
      githubActivity: null,
      signal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'sentiment_unavailable',
      degraded: true,
      degradeReason: 'SENTIMENT_SOURCE_NOT_FOUND',
    };
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }
}

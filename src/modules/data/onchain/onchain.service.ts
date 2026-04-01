import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  CexNetflowSnapshot,
  ExchangeNetflow,
} from '../../../data/contracts/analyze-contracts';

type SantimentResponse = {
  data?: {
    getMetric?: {
      timeseriesData?: Array<{
        datetime: string;
        value: number;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
};

type SantimentMetricResult = {
  data: Array<{ datetime: string; value: number }>;
  error?: string;
};

type SantimentWindow = {
  from: string;
  to: string;
  interval: '5m' | '1h' | '6h' | '12h' | '1d';
  degraded: boolean;
  degradeReason?: string;
};

// Top exchanges for per-exchange metrics
const TOP_EXCHANGES = [
  'binance',
  'coinbase',
  'kraken',
  'okx',
  'bybit',
  'bitget',
  'huobi',
  'gate',
];

@Injectable()
export class OnchainService {
  readonly moduleName = 'onchain';
  private readonly logger = new Logger(OnchainService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchCexNetflow(
    identity: AnalyzeIdentity,
    window: '24h' | '7d' | '30d',
  ): Promise<CexNetflowSnapshot> {
    const result = await this.fetchFromSantiment(identity, window);
    if (result) {
      return result;
    }

    return {
      window,
      inflowUsd: null,
      outflowUsd: null,
      netflowUsd: null,
      signal: 'neutral',
      exchanges: [],
      asOf: new Date().toISOString(),
      sourceUsed: [],
      degraded: true,
      degradeReason: 'CEX_NETFLOW_SOURCE_NOT_FOUND',
    };
  }

  private async fetchFromSantiment(
    identity: AnalyzeIdentity,
    window: '24h' | '7d' | '30d',
  ): Promise<CexNetflowSnapshot | null> {
    const apiKey = process.env.SANTIMENT_ACCESS_KEY;
    if (!apiKey?.trim()) {
      this.logger.warn('SANTIMENT_ACCESS_KEY not configured');
      return null;
    }

    const endpoint =
      process.env.SANTIMENT_GRAPHQL_URL ?? 'https://api.santiment.net/graphql';
    const timeoutMs = Number(process.env.SANTIMENT_TIMEOUT_MS ?? 7000);
    const slug = this.resolveSantimentSlug(identity.symbol);
    const primaryWindow = this.buildPrimaryWindow(window);
    const primary = await this.fetchSantimentWindow(
      endpoint,
      apiKey.trim(),
      timeoutMs,
      slug,
      primaryWindow,
    );
    if (primary) {
      return this.toSnapshot(window, primary, primaryWindow);
    }

    const fallbackWindow = this.buildHistoricalFallbackWindow();
    const fallback = await this.fetchSantimentWindow(
      endpoint,
      apiKey.trim(),
      timeoutMs,
      slug,
      fallbackWindow,
    );
    if (fallback) {
      this.logger.warn(
        `Santiment exchange flow for ${identity.symbol} fell back to delayed historical window ${fallbackWindow.from} -> ${fallbackWindow.to}.`,
      );
      return this.toSnapshot(window, fallback, fallbackWindow);
    }

    return null;
  }

  private buildPrimaryWindow(window: '24h' | '7d' | '30d'): SantimentWindow {
    if (window === '24h') {
      return {
        from: 'utc_now-24h',
        to: 'utc_now',
        interval: '6h',
        degraded: false,
      };
    }

    if (window === '7d') {
      return {
        from: 'utc_now-7d',
        to: 'utc_now',
        interval: '12h',
        degraded: false,
      };
    }

    return {
      from: 'utc_now-30d',
      to: 'utc_now',
      interval: '1d',
      degraded: false,
    };
  }

  private buildHistoricalFallbackWindow(): SantimentWindow {
    return {
      from: 'utc_now-60d',
      to: 'utc_now-30d',
      interval: '1d',
      degraded: true,
      degradeReason: 'CEX_NETFLOW_DELAYED_30D_FALLBACK',
    };
  }

  private async fetchSantimentWindow(
    endpoint: string,
    apiKey: string,
    timeoutMs: number,
    slug: string,
    window: SantimentWindow,
  ): Promise<{
    inflowUsd: number | null;
    outflowUsd: number | null;
    netflowUsd: number | null;
    exchanges: ExchangeNetflow[];
  } | null> {
    const [inflowResult, outflowResult] = await Promise.all([
      this.fetchMetric(
        endpoint,
        apiKey,
        timeoutMs,
        'exchange_inflow_usd',
        slug,
        window.from,
        window.to,
        window.interval,
      ),
      this.fetchMetric(
        endpoint,
        apiKey,
        timeoutMs,
        'exchange_outflow_usd',
        slug,
        window.from,
        window.to,
        window.interval,
      ),
    ]);

    if (inflowResult.error || outflowResult.error) {
      const errorMsg = inflowResult.error || outflowResult.error;
      this.logger.warn(
        `Santiment exchange flow blocked for ${slug} in window ${window.from} -> ${window.to}: ${errorMsg}`,
      );
      return null;
    }

    if (inflowResult.data.length === 0 && outflowResult.data.length === 0) {
      this.logger.warn(
        `No exchange flow data from Santiment for ${slug} in window ${window.from} -> ${window.to}`,
      );
      return null;
    }

    const inflowUsd = this.sumTimeseries(inflowResult.data);
    const outflowUsd = this.sumTimeseries(outflowResult.data);
    const netflowUsd =
      inflowUsd !== null && outflowUsd !== null
        ? this.round(inflowUsd - outflowUsd, 2)
        : null;

    const exchanges = await this.fetchPerExchangeMetrics(
      endpoint,
      apiKey,
      timeoutMs,
      slug,
      window.from,
      window.to,
      window.interval,
    );

    return {
      inflowUsd: this.round(inflowUsd, 2),
      outflowUsd: this.round(outflowUsd, 2),
      netflowUsd,
      exchanges: exchanges
        .sort(
          (a, b) => Math.abs(b.netflowUsd ?? 0) - Math.abs(a.netflowUsd ?? 0),
        )
        .slice(0, 8),
    };
  }

  private toSnapshot(
    window: '24h' | '7d' | '30d',
    data: {
      inflowUsd: number | null;
      outflowUsd: number | null;
      netflowUsd: number | null;
      exchanges: ExchangeNetflow[];
    },
    sourceWindow: SantimentWindow,
  ): CexNetflowSnapshot {
    return {
      window,
      inflowUsd: data.inflowUsd,
      outflowUsd: data.outflowUsd,
      netflowUsd: data.netflowUsd,
      signal: this.toNetflowSignal(data.netflowUsd),
      exchanges: data.exchanges,
      asOf: new Date().toISOString(),
      sourceUsed: ['santiment'],
      degraded: sourceWindow.degraded,
      degradeReason: sourceWindow.degradeReason,
    };
  }

  private async fetchMetric(
    endpoint: string,
    apiKey: string,
    timeoutMs: number,
    metric: string,
    slug: string,
    from: string,
    to: string,
    interval: '5m' | '1h' | '6h' | '12h' | '1d',
  ): Promise<SantimentMetricResult> {
    const query = `
      query ExchangeFlow($metric: String!, $slug: String!, $from: DateTime!, $to: DateTime!, $interval: interval!) {
        getMetric(metric: $metric) {
          timeseriesData(slug: $slug, from: $from, to: $to, interval: $interval) {
            datetime
            value
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Apikey ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          variables: { metric, slug, from, to, interval },
        }),
      });

      if (!response.ok) {
        return { data: [], error: `HTTP ${response.status}` };
      }

      const payload: SantimentResponse = await response.json();

      if (payload.errors?.length) {
        return { data: [], error: payload.errors[0].message };
      }

      return { data: payload.data?.getMetric?.timeseriesData ?? [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: [], error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchPerExchangeMetrics(
    endpoint: string,
    apiKey: string,
    timeoutMs: number,
    slug: string,
    from: string,
    to: string,
    interval: '5m' | '1h' | '6h' | '12h' | '1d',
  ): Promise<ExchangeNetflow[]> {
    const exchanges: ExchangeNetflow[] = [];

    // Fetch netflow per exchange in parallel (using exchange_balance_per_exchange)
    const results = await Promise.all(
      TOP_EXCHANGES.map(async (exchange) => {
        const query = `
          query ExchangeFlowPerExchange($metric: String!, $slug: String!, $owner: String!, $from: DateTime!, $to: DateTime!, $interval: interval!) {
            getMetric(metric: $metric) {
              timeseriesData(
                selector: { slug: $slug, owner: $owner, label: "centralized_exchange" }
                from: $from
                to: $to
                interval: $interval
              ) {
                datetime
                value
              }
            }
          }
        `;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Apikey ${apiKey}`,
            },
            body: JSON.stringify({
              query,
              variables: {
                metric: 'exchange_balance_per_exchange',
                slug,
                owner: exchange,
                from,
                to,
                interval,
              },
            }),
          });

          if (!response.ok) {
            return { exchange, balance: null };
          }

          const payload: SantimentResponse = await response.json();
          const data = payload.data?.getMetric?.timeseriesData ?? [];
          const total = this.sumTimeseries(data);
          return { exchange, balance: total };
        } catch {
          return { exchange, balance: null };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    for (const result of results) {
      if (result.balance !== null) {
        exchanges.push({
          exchange: result.exchange,
          inflowUsd: null,
          outflowUsd: null,
          netflowUsd: this.round(result.balance, 2),
        });
      }
    }

    return exchanges;
  }

  private sumTimeseries(
    data: Array<{ datetime: string; value: number }>,
  ): number | null {
    if (data.length === 0) {
      return null;
    }
    const sum = data.reduce((acc, item) => acc + (item.value ?? 0), 0);
    return sum;
  }

  private resolveSantimentSlug(symbol: string): string {
    const rawMap = process.env.SANTIMENT_SLUG_MAP;
    if (rawMap?.trim()) {
      try {
        const parsed = JSON.parse(rawMap) as Record<string, unknown>;
        const mapped = parsed[symbol.toUpperCase()];
        if (typeof mapped === 'string' && mapped.trim()) {
          return mapped.trim();
        }
      } catch {
        // ignore invalid map
      }
    }

    const normalized = symbol.trim().toLowerCase();
    const builtinMap: Record<string, string> = {
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

    return builtinMap[normalized] ?? normalized;
  }

  private round(value: number | null, digits: number): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(digits));
  }

  private toNetflowSignal(
    netflowUsd: number | null,
  ): CexNetflowSnapshot['signal'] {
    if (netflowUsd === null) {
      return 'neutral';
    }
    if (netflowUsd < 0) {
      return 'buy_pressure';
    }
    if (netflowUsd > 0) {
      return 'sell_pressure';
    }
    return 'neutral';
  }
}

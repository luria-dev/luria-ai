import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  TechnicalSnapshot,
} from '../../../data/contracts/analyze-contracts';

type CoinGeckoSearchCoin = {
  id?: string;
  symbol?: string;
};

type CoinGeckoSearchResponse = {
  coins?: unknown;
};

type CoinGeckoContractResponse = {
  id?: string;
};

type CoinGeckoMarketChartResponse = {
  prices?: unknown;
};

@Injectable()
export class TechnicalService {
  readonly moduleName = 'technical';
  private readonly logger = new Logger(TechnicalService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d' | '30d' | '60d' = '60d',
  ): Promise<TechnicalSnapshot> {
    const prices = await this.fetchPriceSeries(identity, timeWindow);
    if (prices.length < 35) {
      return this.buildUnavailable('TECHNICAL_PRICE_SERIES_INSUFFICIENT');
    }

    const currentPrice = prices[prices.length - 1] ?? null;
    const rsiValue = this.calculateRsi(prices, 14);
    const macdValue = this.calculateEma(prices, 12);
    const macdSlow = this.calculateEma(prices, 26);
    const macd =
      macdValue !== null && macdSlow !== null ? macdValue - macdSlow : null;
    const macdSeries = this.calculateMacdSeries(prices, 12, 26);
    const signalLine =
      macdSeries.length >= 9 ? this.calculateEma(macdSeries, 9) : null;
    const histogram =
      macd !== null && signalLine !== null
        ? Number((macd - signalLine).toFixed(6))
        : null;

    const ma7 = this.calculateSma(prices, 7);
    const ma25 = this.calculateSma(prices, 25);
    const ma99 = this.calculateSma(prices, 99);

    const boll = this.calculateBoll(prices, 20, 2);
    const atrValue = this.calculateAtr(prices, 14);
    const swingHigh = this.findSwingHigh(prices, 5);
    const swingLow = this.findSwingLow(prices, 5);
    const rsiSignal = this.toRsiSignal(rsiValue);
    const macdSignal = this.toMacdSignal(macd, signalLine);
    const maSignal = this.toMaSignal(ma7, ma25, ma99);
    const bollSignal = this.toBollSignal(currentPrice, boll.upper, boll.lower);
    const summarySignal = this.toSummarySignal([
      macdSignal,
      maSignal,
      bollSignal,
      rsiSignal,
    ]);

    return {
      rsi: {
        period: 14,
        value: this.round(rsiValue, 2),
        signal: rsiSignal,
      },
      macd: {
        macd: this.round(macd, 6),
        signalLine: this.round(signalLine, 6),
        histogram,
        signal: macdSignal,
      },
      ma: {
        ma7: this.round(ma7, 6),
        ma25: this.round(ma25, 6),
        ma99: this.round(ma99, 6),
        signal: maSignal,
      },
      boll: {
        upper: this.round(boll.upper, 6),
        middle: this.round(boll.middle, 6),
        lower: this.round(boll.lower, 6),
        bandwidth: this.round(boll.bandwidth, 6),
        signal: bollSignal,
      },
      atr: {
        value: this.round(atrValue, 6),
        period: 14,
      },
      swingHigh: swingHigh !== null ? this.round(swingHigh, 6) : null,
      swingLow: swingLow !== null ? this.round(swingLow, 6) : null,
      summarySignal,
      asOf: new Date().toISOString(),
      sourceUsed: 'coingecko',
      degraded: false,
    };
  }

  private async fetchPriceSeries(
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d' | '30d' | '60d',
  ): Promise<number[]> {
    const coinId = await this.resolveCoinId(identity);
    if (!coinId) {
      return [];
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const daysByWindow = {
      '24h': Number(process.env.COINGECKO_TECH_DAYS_24H ?? 14),
      '7d': Number(process.env.COINGECKO_TECH_DAYS_7D ?? 30),
      '30d': Number(process.env.COINGECKO_TECH_DAYS_30D ?? 90),
      '60d': Number(process.env.COINGECKO_TECH_DAYS_60D ?? 180),
    } as const;
    const days = daysByWindow[timeWindow];

    const params = new URLSearchParams({
      vs_currency: 'usd',
      days: String(days),
      interval: 'hourly',
    });

    const body = await this.fetchJson<CoinGeckoMarketChartResponse>(
      `${baseUrl}/coins/${encodeURIComponent(coinId)}/market_chart?${params.toString()}`,
      timeoutMs,
    );

    return this.extractPrices(body?.prices);
  }

  private extractPrices(input: unknown): number[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const prices: number[] = [];
    for (const row of input) {
      if (!Array.isArray(row) || row.length < 2) {
        continue;
      }

      const price = this.toNumber(row[1]);
      if (price !== null && Number.isFinite(price)) {
        prices.push(price);
      }
    }

    return prices;
  }

  private async resolveCoinId(identity: AnalyzeIdentity): Promise<string | null> {
    const bySource = this.extractCoinGeckoId(identity.sourceId);
    if (bySource) {
      return bySource;
    }

    const platform = this.toCoinGeckoPlatform(identity.chain);
    if (platform) {
      const byContract = await this.fetchCoinByContract(
        platform,
        identity.tokenAddress,
      );
      if (byContract?.id?.trim()) {
        return byContract.id.trim();
      }
    }

    const rows = await this.fetchSearchCoins(identity.symbol);
    const exact = rows.find(
      (row) => (row.symbol ?? '').trim().toUpperCase() === identity.symbol,
    );
    return exact?.id?.trim() || rows[0]?.id?.trim() || null;
  }

  private async fetchSearchCoins(term: string): Promise<CoinGeckoSearchCoin[]> {
    const normalized = term.trim();
    if (!normalized) {
      return [];
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const body = await this.fetchJson<CoinGeckoSearchResponse>(
      `${baseUrl}/search?query=${encodeURIComponent(normalized)}`,
      timeoutMs,
    );

    if (!body || !Array.isArray(body.coins)) {
      return [];
    }

    return body.coins.filter((row): row is CoinGeckoSearchCoin => {
      return Boolean(row && typeof row === 'object');
    });
  }

  private async fetchCoinByContract(
    platform: string,
    tokenAddress: string,
  ): Promise<CoinGeckoContractResponse | null> {
    const address = tokenAddress.trim();
    if (!address) {
      return null;
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const params = new URLSearchParams({
      localization: 'false',
      tickers: 'false',
      market_data: 'false',
      community_data: 'false',
      developer_data: 'false',
      sparkline: 'false',
    });

    return this.fetchJson<CoinGeckoContractResponse>(
      `${baseUrl}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}?${params.toString()}`,
      timeoutMs,
    );
  }

  private getApiBaseUrl(): string {
    const raw =
      process.env.COINGECKO_API_BASE_URL ??
      'https://pro-api.coingecko.com/api/v3';
    const value = raw.trim();
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const apiKey =
      process.env.COINGECKO_ACCESS_KEY ?? process.env.COINGECKO_API_KEY;
    if (!apiKey?.trim()) {
      return headers;
    }

    const key = apiKey.trim();
    if (this.getApiBaseUrl().includes('pro-api.coingecko.com')) {
      headers['x-cg-pro-api-key'] = key;
    } else {
      headers['x-cg-demo-api-key'] = key;
    }

    return headers;
  }

  private getTimeoutMs(): number {
    const configured = Number(
      process.env.COINGECKO_TECH_TIMEOUT_MS ??
        process.env.COINGECKO_TIMEOUT_MS ??
        5000,
    );
    return Number.isFinite(configured) ? Math.max(configured, 12000) : 12000;
  }

  private async fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
    const attempts = Math.max(
      1,
      Number(process.env.COINGECKO_TECH_RETRY_ATTEMPTS ?? 3),
    );

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: this.buildHeaders(),
        });
        if (!response.ok) {
          this.logger.warn(
            `CoinGecko technical fetch failed (${response.status}) for ${url}.`,
          );
          return null;
        }

        return (await response.json()) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          attempt < attempts &&
          (message.includes('aborted') || message.includes('fetch failed'));
        this.logger.warn(
          `CoinGecko technical fetch unavailable${retryable ? ` (attempt ${attempt}/${attempts})` : ''}: ${message}`,
        );
        if (!retryable) {
          return null;
        }
        await this.delay(250 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractCoinGeckoId(sourceId: string): string | null {
    const match = sourceId.match(/^coingecko:(.+)$/);
    if (!match?.[1]) {
      return null;
    }
    return match[1].trim() || null;
  }

  private toCoinGeckoPlatform(chain: string): string | null {
    const normalized = chain.trim().toLowerCase();
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      eth: 'ethereum',
      bsc: 'binance-smart-chain',
      bnb: 'binance-smart-chain',
      solana: 'solana',
      sol: 'solana',
      polygon: 'polygon-pos',
      matic: 'polygon-pos',
      arbitrum: 'arbitrum-one',
      arb: 'arbitrum-one',
      avalanche: 'avalanche',
      avax: 'avalanche',
      base: 'base',
      optimism: 'optimistic-ethereum',
      op: 'optimistic-ethereum',
    };
    return mapping[normalized] ?? null;
  }

  private calculateSma(values: number[], period: number): number | null {
    if (values.length < period) {
      return null;
    }
    const slice = values.slice(values.length - period);
    const sum = slice.reduce((acc, value) => acc + value, 0);
    return sum / period;
  }

  private calculateEma(values: number[], period: number): number | null {
    if (values.length < period) {
      return null;
    }
    const k = 2 / (period + 1);
    let ema =
      values.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
    for (let i = period; i < values.length; i += 1) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calculateMacdSeries(
    values: number[],
    fast: number,
    slow: number,
  ): number[] {
    if (values.length < slow) {
      return [];
    }
    const series: number[] = [];
    for (let i = slow; i <= values.length; i += 1) {
      const window = values.slice(0, i);
      const emaFast = this.calculateEma(window, fast);
      const emaSlow = this.calculateEma(window, slow);
      if (emaFast !== null && emaSlow !== null) {
        series.push(emaFast - emaSlow);
      }
    }
    return series;
  }

  private calculateRsi(values: number[], period: number): number | null {
    if (values.length < period + 1) {
      return null;
    }
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i += 1) {
      const prev = values[i - 1];
      const curr = values[i];
      const diff = curr - prev;
      if (diff > 0) {
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) {
      return 100;
    }
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateBoll(
    values: number[],
    period: number,
    multiplier: number,
  ): {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    bandwidth: number | null;
  } {
    if (values.length < period) {
      return {
        upper: null,
        middle: null,
        lower: null,
        bandwidth: null,
      };
    }
    const window = values.slice(values.length - period);
    const middle = window.reduce((acc, value) => acc + value, 0) / period;
    const variance =
      window.reduce(
        (acc, value) => acc + (value - middle) * (value - middle),
        0,
      ) / period;
    const stdev = Math.sqrt(variance);
    const upper = middle + multiplier * stdev;
    const lower = middle - multiplier * stdev;
    const bandwidth = middle !== 0 ? (upper - lower) / middle : null;
    return {
      upper,
      middle,
      lower,
      bandwidth,
    };
  }

  /**
   * Average True Range (ATR) - measures volatility
   * We approximate using high-low range since we only have close prices
   */
  private calculateAtr(values: number[], period: number): number | null {
    if (values.length < period + 1) {
      return null;
    }
    const ranges: number[] = [];
    for (let i = values.length - period; i < values.length; i += 1) {
      ranges.push(Math.abs(values[i] - values[i - 1]));
    }
    const sum = ranges.reduce((acc, v) => acc + v, 0);
    return sum / period;
  }

  /**
   * Find swing high within lookback window
   */
  private findSwingHigh(values: number[], lookback: number): number | null {
    if (values.length < lookback * 2 + 1) {
      return null;
    }
    const window = values.slice(0, -1); // exclude current bar
    let max = -Infinity;
    let maxIndex = -1;
    for (let i = lookback; i < window.length - lookback; i += 1) {
      const localMax = Math.max(...window.slice(i - lookback, i + lookback + 1));
      if (localMax > max) {
        max = localMax;
        maxIndex = i;
      }
    }
    return maxIndex >= 0 ? max : null;
  }

  /**
   * Find swing low within lookback window
   */
  private findSwingLow(values: number[], lookback: number): number | null {
    if (values.length < lookback * 2 + 1) {
      return null;
    }
    const window = values.slice(0, -1);
    let min = Infinity;
    let minIndex = -1;
    for (let i = lookback; i < window.length - lookback; i += 1) {
      const localMin = Math.min(...window.slice(i - lookback, i + lookback + 1));
      if (localMin < min) {
        min = localMin;
        minIndex = i;
      }
    }
    return minIndex >= 0 ? min : null;
  }

  private toRsiSignal(value: number | null): 'bullish' | 'bearish' | 'neutral' {
    if (value === null) {
      return 'neutral';
    }
    if (value <= 30) {
      return 'bullish';
    }
    if (value >= 70) {
      return 'bearish';
    }
    return 'neutral';
  }

  private toMacdSignal(
    macd: number | null,
    signalLine: number | null,
  ): 'bullish' | 'bearish' | 'neutral' {
    if (macd === null || signalLine === null) {
      return 'neutral';
    }
    if (macd > signalLine) {
      return 'bullish';
    }
    if (macd < signalLine) {
      return 'bearish';
    }
    return 'neutral';
  }

  private toMaSignal(
    ma7: number | null,
    ma25: number | null,
    ma99: number | null,
  ): 'bullish' | 'bearish' | 'neutral' {
    if (ma7 === null || ma25 === null || ma99 === null) {
      return 'neutral';
    }
    if (ma7 > ma25 && ma25 > ma99) {
      return 'bullish';
    }
    if (ma7 < ma25 && ma25 < ma99) {
      return 'bearish';
    }
    return 'neutral';
  }

  private toBollSignal(
    current: number | null,
    upper: number | null,
    lower: number | null,
  ): 'bullish' | 'bearish' | 'neutral' {
    if (current === null || upper === null || lower === null) {
      return 'neutral';
    }
    if (current > upper) {
      return 'bearish';
    }
    if (current < lower) {
      return 'bullish';
    }
    return 'neutral';
  }

  private toSummarySignal(
    signals: Array<'bullish' | 'bearish' | 'neutral'>,
  ): TechnicalSnapshot['summarySignal'] {
    const bullish = signals.filter((signal) => signal === 'bullish').length;
    const bearish = signals.filter((signal) => signal === 'bearish').length;
    if (bullish >= 3) {
      return 'bullish';
    }
    if (bearish >= 3) {
      return 'bearish';
    }
    if (bullish > 0 && bearish > 0) {
      return 'mixed';
    }
    return 'neutral';
  }

  private round(value: number | null, digits: number): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(digits));
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private buildUnavailable(reason: string): TechnicalSnapshot {
    return {
      rsi: {
        period: 14,
        value: null,
        signal: 'neutral',
      },
      macd: {
        macd: null,
        signalLine: null,
        histogram: null,
        signal: 'neutral',
      },
      ma: {
        ma7: null,
        ma25: null,
        ma99: null,
        signal: 'neutral',
      },
      boll: {
        upper: null,
        middle: null,
        lower: null,
        bandwidth: null,
        signal: 'neutral',
      },
      atr: { value: null, period: 14 },
      swingHigh: null,
      swingLow: null,
      summarySignal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'technical_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }
}

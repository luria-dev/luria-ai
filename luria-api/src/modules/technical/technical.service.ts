import { Injectable, Logger } from '@nestjs/common';
import { AnalyzeIdentity, TechnicalSnapshot } from '../../core/contracts/analyze-contracts';

type CoinGeckoMarketChartResponse = {
  prices?: Array<[number, number]>;
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
    timeWindow: '24h' | '7d' = '24h',
  ): Promise<TechnicalSnapshot> {
    const prices = await this.fetchPriceSeries(identity, timeWindow);
    if (prices.length < 35) {
      return this.buildUnavailable('TECHNICAL_PRICE_SERIES_INSUFFICIENT');
    }

    const currentPrice = prices[prices.length - 1] ?? null;
    const rsiValue = this.calculateRsi(prices, 14);
    const macdValue = this.calculateEma(prices, 12);
    const macdSlow = this.calculateEma(prices, 26);
    const macd = macdValue !== null && macdSlow !== null ? macdValue - macdSlow : null;
    const macdSeries = this.calculateMacdSeries(prices, 12, 26);
    const signalLine = macdSeries.length >= 9 ? this.calculateEma(macdSeries, 9) : null;
    const histogram =
      macd !== null && signalLine !== null ? Number((macd - signalLine).toFixed(6)) : null;

    const ma7 = this.calculateSma(prices, 7);
    const ma25 = this.calculateSma(prices, 25);
    const ma99 = this.calculateSma(prices, 99);

    const boll = this.calculateBoll(prices, 20, 2);
    const rsiSignal = this.toRsiSignal(rsiValue);
    const macdSignal = this.toMacdSignal(macd, signalLine);
    const maSignal = this.toMaSignal(ma7, ma25, ma99);
    const bollSignal = this.toBollSignal(currentPrice, boll.upper, boll.lower);
    const summarySignal = this.toSummarySignal([macdSignal, maSignal, bollSignal, rsiSignal]);

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
      summarySignal,
      asOf: new Date().toISOString(),
      sourceUsed: 'coingecko',
      degraded: false,
    };
  }

  private async fetchPriceSeries(
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d',
  ): Promise<number[]> {
    const platform = this.toCoinGeckoPlatform(identity.chain);
    if (!platform) {
      return [];
    }
    const days = timeWindow === '24h' ? '7' : '30';
    const baseUrl = process.env.COINGECKO_API_BASE_URL ?? 'https://api.coingecko.com/api/v3';
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const url =
      `${baseUrl}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(
        identity.tokenAddress,
      )}/market_chart` + `?vs_currency=usd&days=${days}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const apiKey = process.env.COINGECKO_API_KEY;
      if (apiKey?.trim()) {
        headers['x-cg-pro-api-key'] = apiKey.trim();
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        this.logger.warn(`CoinGecko technical fetch failed (${response.status}) for ${identity.symbol}.`);
        return [];
      }

      const body = (await response.json()) as CoinGeckoMarketChartResponse;
      const raw = Array.isArray(body.prices) ? body.prices : [];
      return raw
        .map((item) => (Array.isArray(item) ? item[1] : null))
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CoinGecko technical fetch unavailable for ${identity.symbol}: ${message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
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
    let ema = values.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
    for (let i = period; i < values.length; i += 1) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calculateMacdSeries(values: number[], fast: number, slow: number): number[] {
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
  ): { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null } {
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
      window.reduce((acc, value) => acc + (value - middle) * (value - middle), 0) / period;
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

  private toCoinGeckoPlatform(chain: string): string | null {
    const normalized = chain.trim().toLowerCase();
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      eth: 'ethereum',
      bsc: 'binance-smart-chain',
      bnb: 'binance-smart-chain',
      polygon: 'polygon-pos',
      matic: 'polygon-pos',
      arbitrum: 'arbitrum-one',
      arb: 'arbitrum-one',
      avalanche: 'avalanche',
      avax: 'avalanche',
      base: 'base',
      sol: 'solana',
      solana: 'solana',
    };
    return mapping[normalized] ?? null;
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
      summarySignal: 'neutral',
      asOf: new Date().toISOString(),
      sourceUsed: 'technical_unavailable',
      degraded: true,
      degradeReason: reason,
    };
  }
}

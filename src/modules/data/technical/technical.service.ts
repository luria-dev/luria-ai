import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  TechnicalSnapshot,
} from '../../../data/contracts/analyze-contracts';

type CmcHistoricalResponse = {
  data?: unknown;
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
      summarySignal,
      asOf: new Date().toISOString(),
      sourceUsed: 'coinmarketcap',
      degraded: false,
    };
  }

  private async fetchPriceSeries(
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d',
  ): Promise<number[]> {
    const baseUrl =
      process.env.COINMARKETCAP_API_BASE_URL ??
      'https://pro-api.coinmarketcap.com';
    const path =
      process.env.CMC_HISTORICAL_PATH ?? '/v3/cryptocurrency/quotes/historical';
    const timeoutMs = Number(process.env.COINMARKETCAP_TIMEOUT_MS ?? 5000);
    const interval = '1h';
    const count = timeWindow === '24h' ? '168' : '720';

    const params = new URLSearchParams({
      convert: 'USD',
      interval,
      count,
    });
    const cmcId = this.extractCmcId(identity.sourceId);
    if (cmcId) {
      params.set('id', String(cmcId));
    } else {
      params.set('symbol', identity.symbol.toUpperCase());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const apiKey = process.env.COINMARKETCAP_API_KEY;
      if (apiKey?.trim()) {
        headers['X-CMC_PRO_API_KEY'] = apiKey.trim();
      }

      const response = await fetch(`${baseUrl}${path}?${params.toString()}`, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        this.logger.warn(
          `CoinMarketCap technical fetch failed (${response.status}) for ${identity.symbol}.`,
        );
        return [];
      }

      const body = (await response.json()) as CmcHistoricalResponse;
      return this.extractPrices(body.data, identity.symbol);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CoinMarketCap technical fetch unavailable for ${identity.symbol}: ${message}`,
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractPrices(data: unknown, symbol: string): number[] {
    const target = this.pickDataNode(data, symbol);
    if (!target) {
      return [];
    }

    const candidates: unknown[] = [];
    if (Array.isArray(target)) {
      candidates.push(...target);
    } else if (typeof target === 'object' && target !== null) {
      const obj = target as Record<string, unknown>;
      if (Array.isArray(obj.quotes)) {
        candidates.push(...obj.quotes);
      }
      if (Array.isArray(obj.data)) {
        candidates.push(...obj.data);
      }
      if (Array.isArray(obj.points)) {
        candidates.push(...obj.points);
      }
    }

    const prices: number[] = [];
    for (const item of candidates) {
      const price = this.extractPrice(item);
      if (typeof price === 'number' && Number.isFinite(price)) {
        prices.push(price);
      }
    }
    return prices;
  }

  private pickDataNode(data: unknown, symbol: string): unknown {
    if (!data) {
      return null;
    }
    if (Array.isArray(data)) {
      return data;
    }
    if (typeof data !== 'object') {
      return null;
    }

    const obj = data as Record<string, unknown>;
    const symbolUpper = symbol.toUpperCase();

    for (const [key, value] of Object.entries(obj)) {
      if (key.toUpperCase() === symbolUpper) {
        return value;
      }
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        if (Array.isArray(value)) {
          const first = value[0];
          if (first && typeof first === 'object') {
            const rowSymbol = String(
              (first as Record<string, unknown>).symbol ?? '',
            ).toUpperCase();
            if (rowSymbol === symbolUpper) {
              return value;
            }
          }
        } else {
          const valObj = value as Record<string, unknown>;
          const rowSymbol = String(valObj.symbol ?? '').toUpperCase();
          if (rowSymbol === symbolUpper || Array.isArray(valObj.quotes)) {
            return value;
          }
        }
      }
    }

    return data;
  }

  private extractPrice(item: unknown): number | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const obj = item as Record<string, unknown>;
    const direct = this.toNumber(obj.price ?? obj.close ?? obj.value);
    if (direct !== null) {
      return direct;
    }

    const quote = obj.quote;
    if (quote && typeof quote === 'object') {
      const usd = (quote as Record<string, unknown>).USD;
      if (usd && typeof usd === 'object') {
        const fromUsd = this.toNumber((usd as Record<string, unknown>).price);
        if (fromUsd !== null) {
          return fromUsd;
        }
      }
    }

    return null;
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

  private extractCmcId(sourceId: string): number | null {
    const match = sourceId.match(/^coinmarketcap:(\d+)$/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
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

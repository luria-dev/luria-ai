import { Injectable, Logger } from '@nestjs/common';
import { AnalyzeIdentity, CexNetflowSnapshot, ExchangeNetflow } from '../../core/contracts/analyze-contracts';

type CoinGlassResponse = {
  data?: unknown;
};

@Injectable()
export class OnchainService {
  readonly moduleName = 'onchain';
  private readonly logger = new Logger(OnchainService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchCexNetflow(identity: AnalyzeIdentity, window: '24h' | '7d'): Promise<CexNetflowSnapshot> {
    const coinglass = await this.fetchFromCoinGlass(identity, window);
    if (coinglass) {
      return coinglass;
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

  private async fetchFromCoinGlass(
    identity: AnalyzeIdentity,
    window: '24h' | '7d',
  ): Promise<CexNetflowSnapshot | null> {
    const apiKey = process.env.COINGLASS_API_KEY;
    if (!apiKey?.trim()) {
      return null;
    }

    const baseUrl = process.env.COINGLASS_API_BASE_URL ?? 'https://open-api-v4.coinglass.com/api';
    const timeoutMs = Number(process.env.COINGLASS_TIMEOUT_MS ?? 5000);
    const symbol = this.toCoinGlassSymbol(identity.symbol);
    const interval = window === '24h' ? '1h' : '24h';
    const limit = window === '24h' ? '24' : '7';
    const path = process.env.COINGLASS_NETFLOW_PATH ?? '/futures/netflow-list';
    const url =
      `${baseUrl}${path}` +
      `?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(
        limit,
      )}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'CG-API-KEY': apiKey.trim(),
        },
      });
      if (!response.ok) {
        this.logger.warn(`CoinGlass netflow fetch failed (${response.status}) for ${identity.symbol}.`);
        return null;
      }
      const body = (await response.json()) as CoinGlassResponse;
      const exchanges = this.parseExchangeRows(body.data);
      if (exchanges.length === 0) {
        return null;
      }

      const inflowUsd = this.round(
        exchanges.reduce((sum, item) => sum + (item.inflowUsd ?? 0), 0),
        2,
      );
      const outflowUsd = this.round(
        exchanges.reduce((sum, item) => sum + (item.outflowUsd ?? 0), 0),
        2,
      );
      const netflowUsd =
        inflowUsd !== null && outflowUsd !== null ? this.round(inflowUsd - outflowUsd, 2) : null;

      return {
        window,
        inflowUsd,
        outflowUsd,
        netflowUsd,
        signal: this.toNetflowSignal(netflowUsd),
        exchanges: exchanges
          .sort((a, b) => Math.abs(b.netflowUsd ?? 0) - Math.abs(a.netflowUsd ?? 0))
          .slice(0, 8),
        asOf: new Date().toISOString(),
        sourceUsed: ['coinglass'],
        degraded: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CoinGlass netflow unavailable for ${identity.symbol}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseExchangeRows(data: unknown): ExchangeNetflow[] {
    const rows = this.extractRows(data);
    const parsed: ExchangeNetflow[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const obj = row as Record<string, unknown>;
      const exchange = this.toExchangeName(obj);
      if (!exchange) {
        continue;
      }
      const inflowUsd = this.pickNumber(obj, ['inflow', 'inflowUsd', 'inflow_usd', 'in']);
      const outflowUsd = this.pickNumber(obj, ['outflow', 'outflowUsd', 'outflow_usd', 'out']);
      const rawNet = this.pickNumber(obj, ['netflow', 'netFlow', 'netflowUsd', 'net']);
      const netflowUsd =
        rawNet !== null
          ? rawNet
          : inflowUsd !== null && outflowUsd !== null
            ? this.round(inflowUsd - outflowUsd, 2)
            : null;

      parsed.push({
        exchange,
        inflowUsd: this.round(inflowUsd, 2),
        outflowUsd: this.round(outflowUsd, 2),
        netflowUsd: this.round(netflowUsd, 2),
      });
    }
    return parsed;
  }

  private extractRows(input: unknown): unknown[] {
    if (!input) {
      return [];
    }
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const candidates = [obj.items, obj.list, obj.rows, obj.result, obj.data];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return candidate;
        }
      }
      // CoinGlass sometimes returns map keyed by exchange.
      const entries = Object.entries(obj);
      if (entries.length > 0 && entries.every(([key]) => typeof key === 'string')) {
        return entries.map(([key, value]) =>
          typeof value === 'object' && value !== null
            ? { exchange: key, ...(value as Record<string, unknown>) }
            : { exchange: key, value },
        );
      }
    }
    return [];
  }

  private toExchangeName(row: Record<string, unknown>): string | null {
    const candidates = [
      row.exchange,
      row.exchangeName,
      row.exchange_name,
      row.name,
      row.platform,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toLowerCase();
      }
    }
    return null;
  }

  private pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = row[key];
      const parsed = this.toNumber(value);
      if (parsed !== null) {
        return parsed;
      }
      if (Array.isArray(value) && value.length > 0) {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          const nested = this.toNumber(value[i]);
          if (nested !== null) {
            return nested;
          }
          if (typeof value[i] === 'object' && value[i] !== null) {
            const deep = this.pickNumber(value[i] as Record<string, unknown>, keys);
            if (deep !== null) {
              return deep;
            }
          }
        }
      }
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/,/g, '').trim();
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private round(value: number | null, digits: number): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(digits));
  }

  private toNetflowSignal(netflowUsd: number | null): CexNetflowSnapshot['signal'] {
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

  private toCoinGlassSymbol(symbol: string): string {
    const upper = symbol.trim().toUpperCase();
    const mapping: Record<string, string> = {
      WETH: 'ETH',
      WBTC: 'BTC',
    };
    return mapping[upper] ?? upper;
  }
}

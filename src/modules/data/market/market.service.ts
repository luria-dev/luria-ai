import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeCandidate,
  AnalyzeIdentity,
  PriceSnapshot,
} from '../../../data/contracts/analyze-contracts';

type CmcPlatform = {
  name?: string;
  symbol?: string;
  slug?: string;
  token_address?: string;
};

type CmcMapItem = {
  id?: number;
  name?: string;
  symbol?: string;
  platform?: CmcPlatform | null;
  token_address?: string;
};

type CmcMapResponse = {
  data?: unknown;
};

type CmcQuoteUsd = {
  price?: number | string;
  percent_change_1h?: number | string;
  percent_change_24h?: number | string;
  percent_change_7d?: number | string;
  percent_change_30d?: number | string;
};

type CmcQuoteItem = {
  id?: number;
  symbol?: string;
  quote?: {
    USD?: CmcQuoteUsd;
  };
};

type CmcQuoteResponse = {
  data?: unknown;
};

type PriceMetrics = {
  priceUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
};

@Injectable()
export class MarketService {
  readonly moduleName = 'market';
  private readonly logger = new Logger(MarketService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async searchCandidates(
    query: string,
    preferredChain?: string | null,
  ): Promise<AnalyzeCandidate[]> {
    const terms = this.extractSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const merged = new Map<string, AnalyzeCandidate>();
    for (const term of terms) {
      const rows = await this.fetchCmcMapRows(term);
      for (const row of rows) {
        const candidate = this.toCandidate(row);
        if (!candidate) {
          continue;
        }
        const key = `${candidate.chain}:${candidate.tokenAddress.toLowerCase()}`;
        if (!merged.has(key)) {
          merged.set(key, candidate);
        }
      }
    }

    let candidates = [...merged.values()];

    const targetSymbol = this.extractPrimarySymbol(query);
    if (targetSymbol) {
      const strict = candidates.filter(
        (candidate) => candidate.symbol === targetSymbol,
      );
      if (strict.length > 0) {
        candidates = strict;
      }
    }

    if (preferredChain) {
      const chain = this.normalizeChain(preferredChain);
      candidates = candidates.filter((candidate) => candidate.chain === chain);
    }

    return candidates.slice(0, 8);
  }

  async fetchPrice(identity: AnalyzeIdentity): Promise<PriceSnapshot> {
    const metrics = await this.fetchCoinMarketCapPrice(identity);
    const degradeReason =
      metrics?.priceUsd === null
        ? 'PRICE_SOURCE_NOT_FOUND'
        : metrics?.change24hPct === null
          ? 'PRICE_CHANGE_24H_MISSING'
          : undefined;

    return {
      priceUsd: metrics?.priceUsd ?? null,
      change1hPct: metrics?.change1hPct ?? null,
      change24hPct: metrics?.change24hPct ?? null,
      change7dPct: metrics?.change7dPct ?? null,
      change30dPct: metrics?.change30dPct ?? null,
      asOf: new Date().toISOString(),
      sourceUsed: metrics ? 'coinmarketcap' : 'market_unavailable',
      degraded: !metrics || Boolean(degradeReason),
      degradeReason: !metrics ? 'PRICE_SOURCE_NOT_FOUND' : degradeReason,
    };
  }

  private extractSearchTerms(query: string): string[] {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const terms: string[] = [];
    const primary = this.extractPrimarySymbol(normalized);
    if (primary) {
      terms.push(primary);
    }

    const cleaned = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const tokenMatches = cleaned.match(/[A-Za-z0-9]{2,20}/g) ?? [];
    for (const token of tokenMatches) {
      const upper = token.toUpperCase();
      if (['1H', '24H', '7D', '30D', '1M', 'USDT', 'USDC'].includes(upper)) {
        continue;
      }
      terms.push(upper);
    }

    terms.push(normalized);
    return [...new Set(terms)];
  }

  private extractPrimarySymbol(query: string): string | null {
    const matches = query.toUpperCase().match(/[A-Z0-9]{2,20}/g) ?? [];
    for (const token of matches) {
      if (['1H', '24H', '7D', '30D', '1M', 'USDT', 'USDC'].includes(token)) {
        continue;
      }
      return token;
    }
    return null;
  }

  private async fetchCmcMapRows(term: string): Promise<CmcMapItem[]> {
    const baseUrl =
      process.env.COINMARKETCAP_API_BASE_URL ??
      'https://pro-api.coinmarketcap.com';
    const path = process.env.CMC_MAP_PATH ?? '/v1/cryptocurrency/map';
    const timeoutMs = Number(process.env.COINMARKETCAP_TIMEOUT_MS ?? 5000);
    const url =
      `${baseUrl}${path}?symbol=${encodeURIComponent(term)}` +
      `&limit=${encodeURIComponent(process.env.CMC_MAP_LIMIT ?? '50')}` +
      '&aux=platform';

    const response = await this.fetchWithTimeout(url, timeoutMs);
    if (!response) {
      return [];
    }

    const body = (await response.json()) as CmcMapResponse;
    return this.parseMapRows(body.data);
  }

  private async fetchCoinMarketCapPrice(
    identity: AnalyzeIdentity,
  ): Promise<PriceMetrics | null> {
    const baseUrl =
      process.env.COINMARKETCAP_API_BASE_URL ??
      'https://pro-api.coinmarketcap.com';
    const path =
      process.env.CMC_QUOTES_PATH ?? '/v2/cryptocurrency/quotes/latest';
    const timeoutMs = Number(process.env.COINMARKETCAP_TIMEOUT_MS ?? 5000);

    const cmcId = this.extractCmcId(identity.sourceId);
    const params = new URLSearchParams({
      convert: 'USD',
    });
    if (cmcId) {
      params.set('id', String(cmcId));
    } else {
      params.set('symbol', identity.symbol.toUpperCase());
    }

    const response = await this.fetchWithTimeout(
      `${baseUrl}${path}?${params.toString()}`,
      timeoutMs,
    );
    if (!response) {
      return null;
    }

    const body = (await response.json()) as CmcQuoteResponse;
    const item = this.pickQuoteItem(body.data, identity, cmcId);
    if (!item) {
      return null;
    }

    const usd = item.quote?.USD;
    const priceUsd = this.toNullableNumber(usd?.price);
    const change1hPct = this.toNullableNumber(usd?.percent_change_1h);
    const change24hPct = this.toNullableNumber(usd?.percent_change_24h);
    const change7dPct = this.toNullableNumber(usd?.percent_change_7d);
    const change30dPct = this.toNullableNumber(usd?.percent_change_30d);

    if (
      priceUsd === null &&
      change1hPct === null &&
      change24hPct === null &&
      change7dPct === null &&
      change30dPct === null
    ) {
      return null;
    }

    return {
      priceUsd,
      change1hPct,
      change24hPct,
      change7dPct,
      change30dPct,
    };
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
  ): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const apiKey = process.env.COINMARKETCAP_API_KEY;
      if (apiKey?.trim()) {
        headers['X-CMC_PRO_API_KEY'] = apiKey.trim();
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        this.logger.warn(
          `CoinMarketCap request failed (${response.status}) for ${url}.`,
        );
        return null;
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CoinMarketCap request unavailable for ${url}: ${message}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseMapRows(data: unknown): CmcMapItem[] {
    if (Array.isArray(data)) {
      return data.filter((row): row is CmcMapItem =>
        Boolean(row && typeof row === 'object'),
      );
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.data)) {
        return obj.data.filter((row): row is CmcMapItem =>
          Boolean(row && typeof row === 'object'),
        );
      }
    }
    return [];
  }

  private pickQuoteItem(
    data: unknown,
    identity: AnalyzeIdentity,
    cmcId: number | null,
  ): CmcQuoteItem | null {
    if (!data) {
      return null;
    }

    if (Array.isArray(data)) {
      const byId =
        typeof cmcId === 'number'
          ? data.find(
              (row) =>
                row &&
                typeof row === 'object' &&
                (row as Record<string, unknown>).id === cmcId,
            )
          : null;
      if (byId && typeof byId === 'object') {
        return byId as CmcQuoteItem;
      }
      const bySymbol = data.find(
        (row) =>
          row &&
          typeof row === 'object' &&
          String(
            (row as Record<string, unknown>).symbol ?? '',
          ).toUpperCase() === identity.symbol.toUpperCase(),
      );
      return bySymbol && typeof bySymbol === 'object'
        ? (bySymbol as CmcQuoteItem)
        : null;
    }

    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof cmcId === 'number') {
        const byId = obj[String(cmcId)];
        if (byId && typeof byId === 'object') {
          if (Array.isArray(byId)) {
            const first = byId.find((row) => row && typeof row === 'object');
            return first && typeof first === 'object'
              ? (first as CmcQuoteItem)
              : null;
          }
          return byId as CmcQuoteItem;
        }
      }

      for (const value of Object.values(obj)) {
        if (Array.isArray(value)) {
          const found = value.find(
            (row) =>
              row &&
              typeof row === 'object' &&
              String(
                (row as Record<string, unknown>).symbol ?? '',
              ).toUpperCase() === identity.symbol.toUpperCase(),
          );
          if (found && typeof found === 'object') {
            return found as CmcQuoteItem;
          }
        } else if (value && typeof value === 'object') {
          const symbol = String(
            (value as Record<string, unknown>).symbol ?? '',
          ).toUpperCase();
          if (
            symbol === identity.symbol.toUpperCase() ||
            'quote' in (value as Record<string, unknown>)
          ) {
            return value as CmcQuoteItem;
          }
        }
      }

      if ('quote' in obj) {
        return obj as CmcQuoteItem;
      }
    }

    return null;
  }

  private toCandidate(row: CmcMapItem): AnalyzeCandidate | null {
    const symbol = (row.symbol ?? '').trim().toUpperCase();
    const tokenName = (row.name ?? '').trim();
    const chain = this.normalizeChain(
      row.platform?.slug ?? row.platform?.name ?? '',
    );
    const tokenAddress = (
      row.platform?.token_address ??
      row.token_address ??
      ''
    )
      .trim()
      .toLowerCase();

    if (!symbol || !tokenName || !chain || !tokenAddress) {
      return null;
    }

    return {
      candidateId: `cand-${chain}-${tokenAddress}`,
      tokenName,
      symbol,
      chain,
      tokenAddress,
      quoteToken: 'OTHER',
      sourceId:
        typeof row.id === 'number'
          ? `coinmarketcap:${row.id}`
          : 'coinmarketcap',
    };
  }

  private extractCmcId(sourceId: string): number | null {
    const match = sourceId.match(/^coinmarketcap:(\d+)$/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeChain(raw: string): string {
    const normalized = raw.trim().toLowerCase();
    const aliases: Record<string, string> = {
      eth: 'ethereum',
      ethereum: 'ethereum',
      'ethereum-mainnet': 'ethereum',
      erc20: 'ethereum',
      bnb: 'bsc',
      bsc: 'bsc',
      'binance-smart-chain': 'bsc',
      'binance smart chain': 'bsc',
      bep20: 'bsc',
      sol: 'solana',
      solana: 'solana',
      spl: 'solana',
      polygon: 'polygon',
      matic: 'polygon',
      'polygon-pos': 'polygon',
      arb: 'arbitrum',
      arbitrum: 'arbitrum',
      'arbitrum-one': 'arbitrum',
      avax: 'avalanche',
      avalanche: 'avalanche',
      base: 'base',
      op: 'optimism',
      optimism: 'optimism',
    };
    return aliases[normalized] ?? normalized;
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

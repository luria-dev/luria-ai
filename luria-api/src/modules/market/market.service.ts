import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeCandidate,
  AnalyzeIdentity,
  PriceSnapshot,
} from '../../core/contracts/analyze-contracts';

type DexScreenerPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string | number;
  priceChange?: {
    h1?: string | number;
    h24?: string | number;
  };
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    symbol?: string;
  };
  liquidity?: {
    usd?: number;
  };
};

type DexScreenerSearchResponse = {
  pairs?: DexScreenerPair[];
};

type DexScreenerPairResponse = {
  pair?: DexScreenerPair;
  pairs?: DexScreenerPair[];
};

type CoinGeckoContractResponse = {
  market_data?: {
    current_price?: {
      usd?: number;
    };
    price_change_percentage_24h?: number;
    price_change_percentage_7d?: number;
    price_change_percentage_30d?: number;
  };
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

    const merged = new Map<string, { candidate: AnalyzeCandidate; liquidityUsd: number }>();
    for (const term of terms) {
      const pairs = await this.fetchDexScreenerPairs(term);
      for (const pair of pairs) {
        const candidate = this.toCandidate(pair);
        if (!candidate) {
          continue;
        }

        const liquidityUsd =
          typeof pair.liquidity?.usd === 'number' && Number.isFinite(pair.liquidity.usd)
            ? pair.liquidity.usd
            : 0;
        const key = `${candidate.chain}:${candidate.pairAddress}`;
        const existing = merged.get(key);
        if (!existing || liquidityUsd > existing.liquidityUsd) {
          merged.set(key, { candidate, liquidityUsd });
        }
      }
    }

    let candidates = [...merged.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);

    const targetSymbol = this.extractPrimarySymbol(query);
    if (targetSymbol) {
      const strict = candidates.filter(({ candidate }) => candidate.symbol === targetSymbol);
      if (strict.length > 0) {
        candidates = strict;
      }
    }

    if (preferredChain) {
      const chain = this.normalizeChain(preferredChain);
      candidates = candidates.filter(({ candidate }) => candidate.chain === chain);
    }

    return candidates.slice(0, 8).map(({ candidate }) => candidate);
  }

  async fetchPrice(identity: AnalyzeIdentity): Promise<PriceSnapshot> {
    const [dexMetrics, coinGeckoMetrics] = await Promise.all([
      this.fetchDexScreenerPrice(identity),
      this.fetchCoinGeckoPrice(identity),
    ]);

    const priceUsd = dexMetrics?.priceUsd ?? coinGeckoMetrics?.priceUsd ?? null;
    const change1hPct = dexMetrics?.change1hPct ?? null;
    const change24hPct = dexMetrics?.change24hPct ?? coinGeckoMetrics?.change24hPct ?? null;
    const change7dPct = coinGeckoMetrics?.change7dPct ?? null;
    const change30dPct = coinGeckoMetrics?.change30dPct ?? null;

    const sourceUsed: PriceSnapshot['sourceUsed'] =
      dexMetrics && coinGeckoMetrics
        ? 'dexscreener+coingecko'
        : dexMetrics
          ? 'dexscreener'
          : coinGeckoMetrics
            ? 'coingecko'
            : 'market_unavailable';
    const degradeReason =
      priceUsd === null
        ? 'PRICE_SOURCE_NOT_FOUND'
        : change24hPct === null
          ? 'PRICE_CHANGE_24H_MISSING'
          : undefined;

    return {
      priceUsd,
      change1hPct,
      change24hPct,
      change7dPct,
      change30dPct,
      asOf: new Date().toISOString(),
      sourceUsed,
      degraded: Boolean(degradeReason),
      degradeReason,
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
    const tokenMatches = cleaned.match(/[A-Za-z0-9]{2,15}/g) ?? [];
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
    const matches = query.toUpperCase().match(/[A-Z0-9]{2,15}/g) ?? [];
    for (const token of matches) {
      if (['1H', '24H', '7D', '30D', '1M', 'USDT', 'USDC'].includes(token)) {
        continue;
      }
      return token;
    }
    return null;
  }

  private async fetchDexScreenerPrice(identity: AnalyzeIdentity): Promise<PriceMetrics | null> {
    const pair = await this.fetchDexScreenerPair(identity.chain, identity.pairAddress);
    if (!pair) {
      return null;
    }

    const priceUsd = this.toNullableNumber(pair.priceUsd);
    const change1hPct = this.toNullableNumber(pair.priceChange?.h1);
    const change24hPct = this.toNullableNumber(pair.priceChange?.h24);

    if (priceUsd === null && change24hPct === null && change1hPct === null) {
      return null;
    }

    return {
      priceUsd,
      change1hPct,
      change24hPct,
      change7dPct: null,
      change30dPct: null,
    };
  }

  private async fetchCoinGeckoPrice(identity: AnalyzeIdentity): Promise<PriceMetrics | null> {
    const platform = this.getCoinGeckoPlatform(identity.chain);
    if (!platform) {
      return null;
    }

    const baseUrl = process.env.COINGECKO_API_BASE_URL ?? 'https://api.coingecko.com/api/v3';
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const url =
      `${baseUrl}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(
        identity.tokenAddress,
      )}` +
      '?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const apiKey = process.env.COINGECKO_API_KEY;
      if (apiKey) {
        headers['x-cg-pro-api-key'] = apiKey;
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        this.logger.warn(`CoinGecko contract price failed (${response.status}) for ${identity.symbol}.`);
        return null;
      }
      const body = (await response.json()) as CoinGeckoContractResponse;
      const marketData = body.market_data;
      if (!marketData) {
        return null;
      }

      const priceUsd = this.toNullableNumber(marketData.current_price?.usd);
      const change24hPct = this.toNullableNumber(marketData.price_change_percentage_24h);
      const change7dPct = this.toNullableNumber(marketData.price_change_percentage_7d);
      const change30dPct = this.toNullableNumber(marketData.price_change_percentage_30d);
      if (priceUsd === null && change24hPct === null && change7dPct === null && change30dPct === null) {
        return null;
      }

      return {
        priceUsd,
        change1hPct: null,
        change24hPct,
        change7dPct,
        change30dPct,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CoinGecko contract price unavailable for ${identity.symbol}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchDexScreenerPair(
    chain: string,
    pairAddress: string,
  ): Promise<DexScreenerPair | null> {
    const baseUrl = process.env.DEXSCREENER_PAIR_URL ?? 'https://api.dexscreener.com/latest/dex/pairs';
    const timeoutMs = Number(process.env.DEXSCREENER_TIMEOUT_MS ?? 5000);
    const chainId = this.toDexScreenerChain(chain);
    const url = `${baseUrl}/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`DexScreener pair fetch failed (${response.status}) for ${chain}:${pairAddress}.`);
        return null;
      }

      const body = (await response.json()) as DexScreenerPairResponse;
      if (body.pair) {
        return body.pair;
      }
      if (Array.isArray(body.pairs) && body.pairs.length > 0) {
        return body.pairs[0];
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DexScreener pair fetch unavailable for ${chain}:${pairAddress}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchDexScreenerPairs(term: string): Promise<DexScreenerPair[]> {
    const baseUrl = process.env.DEXSCREENER_SEARCH_URL ?? 'https://api.dexscreener.com/latest/dex/search';
    const url = `${baseUrl}?q=${encodeURIComponent(term)}`;
    const timeoutMs = Number(process.env.DEXSCREENER_TIMEOUT_MS ?? 5000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`DexScreener search failed (${response.status}) for term: ${term}`);
        return [];
      }

      const body = (await response.json()) as DexScreenerSearchResponse;
      return Array.isArray(body.pairs) ? body.pairs : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DexScreener search unavailable for term "${term}": ${message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private toCandidate(pair: DexScreenerPair): AnalyzeCandidate | null {
    const chain = this.normalizeChain(pair.chainId ?? '');
    const symbol = (pair.baseToken?.symbol ?? '').trim().toUpperCase();
    const tokenName = (pair.baseToken?.name ?? '').trim();
    const tokenAddress = (pair.baseToken?.address ?? '').trim();
    const pairAddress = (pair.pairAddress ?? '').trim();
    const quote = (pair.quoteToken?.symbol ?? '').trim().toUpperCase();

    if (!chain || !symbol || !tokenName || !tokenAddress || !pairAddress) {
      return null;
    }
    if (quote !== 'USDT' && quote !== 'USDC') {
      return null;
    }

    return {
      candidateId: `cand-${chain}-${pairAddress.toLowerCase()}`,
      tokenName,
      symbol,
      chain,
      tokenAddress,
      quoteToken: quote,
      pairAddress,
      sourceId: pair.dexId ? `dexscreener:${pair.dexId}` : 'dexscreener',
    };
  }

  private normalizeChain(raw: string): string {
    const normalized = raw.trim().toLowerCase();
    const aliases: Record<string, string> = {
      eth: 'ethereum',
      ethereum: 'ethereum',
      bnb: 'bsc',
      bsc: 'bsc',
      'binance-smart-chain': 'bsc',
      sol: 'solana',
      solana: 'solana',
      polygon: 'polygon',
      matic: 'polygon',
      arb: 'arbitrum',
      arbitrum: 'arbitrum',
      avax: 'avalanche',
      avalanche: 'avalanche',
      base: 'base',
    };
    return aliases[normalized] ?? normalized;
  }

  private toDexScreenerChain(raw: string): string {
    return this.normalizeChain(raw);
  }

  private getCoinGeckoPlatform(chain: string): string | null {
    const normalized = this.normalizeChain(chain);
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      bsc: 'binance-smart-chain',
      polygon: 'polygon-pos',
      arbitrum: 'arbitrum-one',
      avalanche: 'avalanche',
      base: 'base',
      solana: 'solana',
    };
    return mapping[normalized] ?? null;
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

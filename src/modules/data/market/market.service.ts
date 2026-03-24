import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeCandidate,
  AnalyzeIdentity,
  PriceSnapshot,
} from '../../../data/contracts/analyze-contracts';
import { TOKEN_REGISTRY, CHAIN_PRIORITY } from './native-tokens';

type CoinGeckoSearchCoin = {
  id?: string;
  name?: string;
  symbol?: string;
};

type CoinGeckoSearchResponse = {
  coins?: unknown;
};

type CoinGeckoMarketData = {
  current_price?: { usd?: unknown };
  market_cap?: { usd?: unknown };
  price_change_percentage_1h_in_currency?: unknown;
  price_change_percentage_24h_in_currency?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  price_change_percentage_30d_in_currency?: unknown;
  ath?: { usd?: unknown };
  atl?: { usd?: unknown };
  ath_change_percentage?: { usd?: unknown };
  atl_change_percentage?: { usd?: unknown };
  fully_diluted_valuation?: { usd?: unknown };
  total_volume?: { usd?: unknown };
  circulating_supply?: unknown;
  total_supply?: unknown;
  max_supply?: unknown;
};

type CoinGeckoCoinDetail = {
  id?: string;
  symbol?: string;
  name?: string;
  platforms?: Record<string, unknown>;
  market_data?: CoinGeckoMarketData;
};

type CoinGeckoMarketsRow = {
  id?: string;
  symbol?: string;
  current_price?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
  fully_diluted_valuation?: unknown;
  total_volume?: unknown;
  circulating_supply?: unknown;
  total_supply?: unknown;
  max_supply?: unknown;
  ath?: unknown;
  atl?: unknown;
  ath_change_percentage?: unknown;
  atl_change_percentage?: unknown;
  price_change_percentage_1h_in_currency?: unknown;
  price_change_percentage_24h_in_currency?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  price_change_percentage_30d_in_currency?: unknown;
};

type PriceMetrics = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  marketCapRank: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  fdvUsd: number | null;
  totalVolume24hUsd: number | null;
  athUsd: number | null;
  atlUsd: number | null;
  athChangePct: number | null;
  atlChangePct: number | null;
};

type MarketFetchErrorCode =
  | 'PRICE_SOURCE_NOT_FOUND'
  | 'COINGECKO_HTTP_401'
  | 'COINGECKO_HTTP_403'
  | 'COINGECKO_HTTP_404'
  | 'COINGECKO_HTTP_429'
  | 'COINGECKO_HTTP_5XX'
  | 'COINGECKO_HTTP_ERROR'
  | 'COINGECKO_CONNECT_TIMEOUT'
  | 'COINGECKO_ABORT_TIMEOUT'
  | 'COINGECKO_NETWORK_ERROR'
  | 'COINGECKO_EMPTY_RESPONSE';

type MarketFetchResult<T> = {
  data: T | null;
  errorCode?: MarketFetchErrorCode;
};

type PriceLookupResult = {
  metrics: PriceMetrics | null;
  errorCode?: MarketFetchErrorCode;
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
    const terms = this.extractSearchTerms(query).slice(0, 4);
    if (terms.length === 0) {
      return [];
    }

    const coinIds = new Set<string>();
    for (const term of terms) {
      const rows = await this.fetchSearchCoins(term);
      for (const row of rows.slice(0, 10)) {
        if (row.id?.trim()) {
          coinIds.add(row.id.trim());
        }
      }
    }

    const detailIds = [...coinIds].slice(
      0,
      Number(process.env.COINGECKO_SEARCH_MAX_COINS ?? 12),
    );
    const details = await Promise.all(
      detailIds.map((coinId) => this.fetchCoinDetail(coinId, false)),
    );

    // Build all chain candidates per coinId
    const byCoinId = new Map<string, AnalyzeCandidate[]>();
    for (const detailResult of details) {
      const detail = detailResult.data;
      if (!detail) {
        continue;
      }
      const coinId = (detail.id ?? '').trim();
      if (!coinId) {
        continue;
      }
      const candidatesForCoin = this.toCandidates(detail);
      if (candidatesForCoin.length > 0) {
        byCoinId.set(coinId, candidatesForCoin);
      }
    }

    // For each coin, pick exactly ONE representative candidate (primary chain)
    // This avoids returning 11 candidates for USDT across 11 chains
    const resolved: AnalyzeCandidate[] = [];
    for (const [, candidatesForCoin] of byCoinId) {
      const symbol = candidatesForCoin[0].symbol;
      const preferred = this.selectPrimaryCandidate(
        candidatesForCoin,
        symbol,
        preferredChain,
      );
      if (preferred) {
        resolved.push(preferred);
      }
    }

    // If user specified a preferredChain, filter to that chain
    if (preferredChain) {
      const chain = this.normalizeChain(preferredChain);
      const filtered = resolved.filter((c) => c.chain === chain);
      if (filtered.length > 0) {
        return filtered.slice(0, 8);
      }
    }

    // Symbol-level narrowing: prefer candidates matching the primary symbol
    const targetSymbol = this.extractPrimarySymbol(query);
    if (targetSymbol) {
      const strict = resolved.filter((c) => c.symbol === targetSymbol);
      if (strict.length > 0) {
        return strict.slice(0, 8);
      }
    }

    return resolved.slice(0, 8);
  }

  async fetchPrice(identity: AnalyzeIdentity): Promise<PriceSnapshot> {
    const { metrics, errorCode } = await this.fetchCoinGeckoPrice(identity);
    const degradeReason =
      metrics?.priceUsd === null
        ? errorCode ?? 'PRICE_SOURCE_NOT_FOUND'
        : metrics?.change24hPct === null
          ? 'PRICE_CHANGE_24H_MISSING'
          : undefined;

    return {
      priceUsd: metrics?.priceUsd ?? null,
      marketCapUsd: metrics?.marketCapUsd ?? null,
      change1hPct: metrics?.change1hPct ?? null,
      change24hPct: metrics?.change24hPct ?? null,
      change7dPct: metrics?.change7dPct ?? null,
      change30dPct: metrics?.change30dPct ?? null,
      marketCapRank: metrics?.marketCapRank ?? null,
      circulatingSupply: metrics?.circulatingSupply ?? null,
      totalSupply: metrics?.totalSupply ?? null,
      maxSupply: metrics?.maxSupply ?? null,
      fdvUsd: metrics?.fdvUsd ?? null,
      totalVolume24hUsd: metrics?.totalVolume24hUsd ?? null,
      athUsd: metrics?.athUsd ?? null,
      atlUsd: metrics?.atlUsd ?? null,
      athChangePct: metrics?.athChangePct ?? null,
      atlChangePct: metrics?.atlChangePct ?? null,
      asOf: new Date().toISOString(),
      sourceUsed: metrics ? 'coingecko' : 'market_unavailable',
      degraded: !metrics || Boolean(degradeReason),
      degradeReason: !metrics ? errorCode ?? 'PRICE_SOURCE_NOT_FOUND' : degradeReason,
    };
  }

  private async fetchCoinGeckoPrice(
    identity: AnalyzeIdentity,
  ): Promise<PriceLookupResult> {
    const symbol = identity.symbol.toUpperCase();
    const meta = TOKEN_REGISTRY[symbol];

    // Prefer contract lookup for contract tokens when address exists
    const byContract =
      meta?.hasContract && identity.tokenAddress.trim()
        ? await this.fetchPriceByContract(identity)
        : null;
    if (byContract) {
      return { metrics: byContract };
    }

    // Prefer registry coinId directly for known tokens
    const registryCoinId = meta?.coinId?.trim() || null;
    const coinId = registryCoinId ?? (await this.resolveCoinId(identity));
    if (!coinId) {
      return {
        metrics: null,
        errorCode: 'PRICE_SOURCE_NOT_FOUND',
      };
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const params = new URLSearchParams({
      vs_currency: 'usd',
      ids: coinId,
      price_change_percentage: '1h,24h,7d,30d',
      per_page: '1',
      page: '1',
      sparkline: 'false',
      locale: 'en',
    });

    const marketResponse = await this.fetchJson<CoinGeckoMarketsRow[]>(
      `${baseUrl}/coins/markets?${params.toString()}`,
      timeoutMs,
    );
    const rows = marketResponse.data;

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row && registryCoinId) {
      // Fallback to coin detail endpoint for known coin ids
      const detailResponse = await this.fetchCoinDetail(registryCoinId, true);
      const detail = detailResponse.data;
      if (detail?.market_data) {
        return {
          metrics: this.toPriceMetricsFromCoinDetail(detail),
          errorCode: detailResponse.errorCode,
        };
      }
      return {
        metrics: null,
        errorCode:
          detailResponse.errorCode ??
          marketResponse.errorCode ??
          'COINGECKO_EMPTY_RESPONSE',
      };
    }
    if (!row) {
      return {
        metrics: null,
        errorCode: marketResponse.errorCode ?? 'COINGECKO_EMPTY_RESPONSE',
      };
    }

    const priceUsd = this.toNullableNumber(row.current_price);
    const marketCapUsd = this.toNullableNumber(row.market_cap);
    const change1hPct = this.toNullableUsdPercent(
      row.price_change_percentage_1h_in_currency,
    );
    const change24hPct = this.toNullableUsdPercent(
      row.price_change_percentage_24h_in_currency,
    );
    const change7dPct = this.toNullableUsdPercent(
      row.price_change_percentage_7d_in_currency,
    );
    const change30dPct = this.toNullableUsdPercent(
      row.price_change_percentage_30d_in_currency,
    );
    const marketCapRank = this.toNullableNumber(row.market_cap_rank);
    const circulatingSupply = this.toNullableNumber(row.circulating_supply);
    const totalSupply = this.toNullableNumber(row.total_supply);
    const maxSupply = this.toNullableNumber(row.max_supply);
    const fdvUsd = this.toNullableNumber(row.fully_diluted_valuation);
    const totalVolume24hUsd = this.toNullableNumber(row.total_volume);
    const athUsd = this.toNullableNumber(row.ath);
    const atlUsd = this.toNullableNumber(row.atl);
    const athChangePct = this.toNullableNumber(row.ath_change_percentage);
    const atlChangePct = this.toNullableNumber(row.atl_change_percentage);

    if (
      priceUsd === null &&
      marketCapUsd === null &&
      change1hPct === null &&
      change24hPct === null &&
      change7dPct === null &&
      change30dPct === null
    ) {
      return {
        metrics: null,
        errorCode: marketResponse.errorCode ?? 'COINGECKO_EMPTY_RESPONSE',
      };
    }

    return {
      metrics: {
        priceUsd,
        marketCapUsd,
        change1hPct,
        change24hPct,
        change7dPct,
        change30dPct,
        marketCapRank,
        circulatingSupply,
        totalSupply,
        maxSupply,
        fdvUsd,
        totalVolume24hUsd,
        athUsd,
        atlUsd,
        athChangePct,
        atlChangePct,
      },
    };
  }

  private toPriceMetricsFromCoinDetail(detail: CoinGeckoCoinDetail): PriceMetrics | null {
    if (!detail.market_data) {
      return null;
    }

    const data = detail.market_data;
    const priceUsd = this.toNullableNumber(data.current_price?.usd);
    const marketCapUsd = this.toNullableNumber(data.market_cap?.usd);
    const change1hPct = this.toNullableUsdPercent(
      data.price_change_percentage_1h_in_currency,
    );
    const change24hPct = this.toNullableUsdPercent(
      data.price_change_percentage_24h_in_currency,
    );
    const change7dPct = this.toNullableUsdPercent(
      data.price_change_percentage_7d_in_currency,
    );
    const change30dPct = this.toNullableUsdPercent(
      data.price_change_percentage_30d_in_currency,
    );
    const athUsd = this.toNullableNumber(data.ath?.usd);
    const atlUsd = this.toNullableNumber(data.atl?.usd);
    const athChangePct = this.toNullableUsdPercent(data.ath_change_percentage);
    const atlChangePct = this.toNullableUsdPercent(data.atl_change_percentage);
    const fdvUsd = this.toNullableNumber(data.fully_diluted_valuation?.usd);
    const totalVolume24hUsd = this.toNullableNumber(data.total_volume?.usd);
    const circulatingSupply = this.toNullableNumber(data.circulating_supply);
    const totalSupply = this.toNullableNumber(data.total_supply);
    const maxSupply = this.toNullableNumber(data.max_supply);

    if (
      priceUsd === null &&
      marketCapUsd === null &&
      change1hPct === null &&
      change24hPct === null &&
      change7dPct === null &&
      change30dPct === null
    ) {
      return null;
    }

    return {
      priceUsd,
      marketCapUsd,
      change1hPct,
      change24hPct,
      change7dPct,
      change30dPct,
      marketCapRank: null,
      circulatingSupply,
      totalSupply,
      maxSupply,
      fdvUsd,
      totalVolume24hUsd,
      athUsd,
      atlUsd,
      athChangePct,
      atlChangePct,
    };
  }

  private async fetchPriceByContract(
    identity: AnalyzeIdentity,
  ): Promise<PriceMetrics | null> {
    const platform = this.toCoinGeckoPlatform(identity.chain);
    if (!platform) {
      return null;
    }

    const detail = await this.fetchCoinByContract(
      platform,
      identity.tokenAddress,
      true,
    );
    if (!detail.data?.market_data) {
      return null;
    }

    const data = detail.data.market_data;
    const priceUsd = this.toNullableNumber(data.current_price?.usd);
    const marketCapUsd = this.toNullableNumber(data.market_cap?.usd);
    const change1hPct = this.toNullableUsdPercent(
      data.price_change_percentage_1h_in_currency,
    );
    const change24hPct = this.toNullableUsdPercent(
      data.price_change_percentage_24h_in_currency,
    );
    const change7dPct = this.toNullableUsdPercent(
      data.price_change_percentage_7d_in_currency,
    );
    const change30dPct = this.toNullableUsdPercent(
      data.price_change_percentage_30d_in_currency,
    );
    const athUsd = this.toNullableNumber(data.ath?.usd);
    const atlUsd = this.toNullableNumber(data.atl?.usd);
    const athChangePct = this.toNullableUsdPercent(data.ath_change_percentage);
    const atlChangePct = this.toNullableUsdPercent(data.atl_change_percentage);
    const fdvUsd = this.toNullableNumber(data.fully_diluted_valuation?.usd);
    const totalVolume24hUsd = this.toNullableNumber(data.total_volume?.usd);
    const circulatingSupply = this.toNullableNumber(data.circulating_supply);
    const totalSupply = this.toNullableNumber(data.total_supply);
    const maxSupply = this.toNullableNumber(data.max_supply);

    if (
      priceUsd === null &&
      marketCapUsd === null &&
      change1hPct === null &&
      change24hPct === null &&
      change7dPct === null &&
      change30dPct === null
    ) {
      return null;
    }

    return {
      priceUsd,
      marketCapUsd,
      change1hPct,
      change24hPct,
      change7dPct,
      change30dPct,
      marketCapRank: null,
      circulatingSupply,
      totalSupply,
      maxSupply,
      fdvUsd,
      totalVolume24hUsd,
      athUsd,
      atlUsd,
      athChangePct,
      atlChangePct,
    };
  }

  private async resolveCoinId(identity: AnalyzeIdentity): Promise<string | null> {
    const fromSource = this.extractCoinGeckoId(identity.sourceId);
    if (fromSource) {
      return fromSource;
    }

    const platform = this.toCoinGeckoPlatform(identity.chain);
    if (platform) {
      const byContract = await this.fetchCoinByContract(
        platform,
        identity.tokenAddress,
        false,
      );
      if (byContract.data?.id?.trim()) {
        return byContract.data.id.trim();
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
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const url = `${baseUrl}/search?query=${encodeURIComponent(normalized)}`;

    const body = (await this.fetchJson<CoinGeckoSearchResponse>(url, timeoutMs))
      .data;
    if (!body || !Array.isArray(body.coins)) {
      return [];
    }

    return body.coins.filter((row): row is CoinGeckoSearchCoin => {
      return Boolean(row && typeof row === 'object');
    });
  }

  private async fetchCoinDetail(
    coinId: string,
    includeMarketData: boolean,
  ): Promise<MarketFetchResult<CoinGeckoCoinDetail>> {
    const id = coinId.trim();
    if (!id) {
      return {
        data: null,
        errorCode: 'PRICE_SOURCE_NOT_FOUND',
      };
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const params = new URLSearchParams({
      localization: 'false',
      tickers: 'false',
      market_data: includeMarketData ? 'true' : 'false',
      community_data: 'false',
      developer_data: 'false',
      sparkline: 'false',
    });

    return this.fetchJson<CoinGeckoCoinDetail>(
      `${baseUrl}/coins/${encodeURIComponent(id)}?${params.toString()}`,
      timeoutMs,
    );
  }

  private async fetchCoinByContract(
    platform: string,
    tokenAddress: string,
    includeMarketData: boolean,
  ): Promise<MarketFetchResult<CoinGeckoCoinDetail>> {
    const address = tokenAddress.trim();
    if (!address) {
      return {
        data: null,
        errorCode: 'PRICE_SOURCE_NOT_FOUND',
      };
    }

    const baseUrl = this.getApiBaseUrl();
    const timeoutMs = Number(process.env.COINGECKO_TIMEOUT_MS ?? 5000);
    const params = new URLSearchParams({
      localization: 'false',
      tickers: 'false',
      market_data: includeMarketData ? 'true' : 'false',
      community_data: 'false',
      developer_data: 'false',
      sparkline: 'false',
    });

    return this.fetchJson<CoinGeckoCoinDetail>(
      `${baseUrl}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}?${params.toString()}`,
      timeoutMs,
    );
  }

  private toCandidates(detail: CoinGeckoCoinDetail): AnalyzeCandidate[] {
    const symbol = (detail.symbol ?? '').trim().toUpperCase();
    const tokenName = (detail.name ?? '').trim();
    const coinId = (detail.id ?? '').trim();
    if (!symbol || !tokenName || !coinId) {
      return [];
    }

    const platforms = detail.platforms;
    if (!platforms || typeof platforms !== 'object') {
      return [];
    }

    const candidates: AnalyzeCandidate[] = [];
    for (const [platform, rawAddress] of Object.entries(platforms)) {
      // Handle native coins: platform="" and address="" means native chain
      // Use the registry to resolve the correct chain and coinId
      if (!platform.trim()) {
        const meta = TOKEN_REGISTRY[symbol];
        if (meta) {
          candidates.push({
            candidateId: `cand-${meta.chain}-${coinId}`,
            tokenName,
            symbol,
            chain: meta.chain,
            tokenAddress: '',
            quoteToken: 'OTHER',
            sourceId: `coingecko:${coinId}`,
          });
        }
        continue;
      }

      const chain = this.normalizeChain(platform);
      if (!chain) {
        continue;
      }

      const tokenAddress = this.normalizeTokenAddress(chain, rawAddress);
      if (!tokenAddress) {
        continue;
      }

      candidates.push({
        candidateId: `cand-${chain}-${tokenAddress.toLowerCase()}`,
        tokenName,
        symbol,
        chain,
        tokenAddress,
        quoteToken: 'OTHER',
        sourceId: `coingecko:${coinId}`,
      });
    }

    return candidates;
  }

  private selectPrimaryCandidate(
    candidates: AnalyzeCandidate[],
    symbol: string,
    preferredChain?: string | null,
  ): AnalyzeCandidate | null {
    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }

    // 1. User-specified preferred chain wins
    if (preferredChain) {
      const chain = this.normalizeChain(preferredChain);
      const match = candidates.find((c) => c.chain === chain);
      if (match) {
        return match;
      }
    }

    // 2. Registry: native chain for well-known tokens
    const meta = TOKEN_REGISTRY[symbol];
    if (meta) {
      const match = candidates.find((c) => c.chain === meta.chain);
      if (match) {
        return match;
      }
    }

    // 3. Chain priority fallback for unknown tokens
    for (const chain of CHAIN_PRIORITY) {
      const match = candidates.find((c) => c.chain === chain);
      if (match) {
        return match;
      }
    }

    return candidates[0];
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

  private extractCoinGeckoId(sourceId: string): string | null {
    const match = sourceId.match(/^coingecko:(.+)$/);
    if (!match?.[1]) {
      return null;
    }
    return match[1].trim() || null;
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

  private async fetchJson<T>(
    url: string,
    timeoutMs: number,
  ): Promise<MarketFetchResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        const errorCode = this.toHttpErrorCode(response.status);
        this.logger.warn(
          `CoinGecko request failed (${response.status}, ${errorCode}) for ${url}.`,
        );
        return { data: null, errorCode };
      }

      return { data: (await response.json()) as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = this.toNetworkErrorCode(error);
      this.logger.warn(
        `CoinGecko request unavailable (${errorCode}) for ${url}: ${message}`,
      );
      return { data: null, errorCode };
    } finally {
      clearTimeout(timeout);
    }
  }

  private toHttpErrorCode(status: number): MarketFetchErrorCode {
    if (status === 401) {
      return 'COINGECKO_HTTP_401';
    }
    if (status === 403) {
      return 'COINGECKO_HTTP_403';
    }
    if (status === 404) {
      return 'COINGECKO_HTTP_404';
    }
    if (status === 429) {
      return 'COINGECKO_HTTP_429';
    }
    if (status >= 500) {
      return 'COINGECKO_HTTP_5XX';
    }
    return 'COINGECKO_HTTP_ERROR';
  }

  private toNetworkErrorCode(error: unknown): MarketFetchErrorCode {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'COINGECKO_ABORT_TIMEOUT';
    }

    const code =
      error && typeof error === 'object' && 'cause' in error
        ? (error.cause as { code?: unknown })?.code
        : undefined;

    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      return 'COINGECKO_CONNECT_TIMEOUT';
    }

    return 'COINGECKO_NETWORK_ERROR';
  }

  private toCoinGeckoPlatform(chain: string): string | null {
    const normalized = this.normalizeChain(chain);
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      bsc: 'binance-smart-chain',
      solana: 'solana',
      polygon: 'polygon-pos',
      arbitrum: 'arbitrum-one',
      avalanche: 'avalanche',
      base: 'base',
      optimism: 'optimistic-ethereum',
    };
    return mapping[normalized] ?? null;
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
      'optimistic-ethereum': 'optimism',
    };
    return aliases[normalized] ?? normalized;
  }

  private normalizeTokenAddress(chain: string, value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (['ethereum', 'bsc', 'polygon', 'arbitrum', 'avalanche', 'base', 'optimism'].includes(chain)) {
      return trimmed.toLowerCase();
    }

    return trimmed;
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

  private toNullableUsdPercent(value: unknown): number | null {
    const direct = this.toNullableNumber(value);
    if (direct !== null) {
      return direct;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const usdValue = (value as { usd?: unknown }).usd;
    return this.toNullableNumber(usdValue);
  }
}

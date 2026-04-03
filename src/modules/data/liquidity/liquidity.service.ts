import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  LiquidityVenueSnapshot,
  LiquiditySnapshot,
} from '../../../data/contracts/analyze-contracts';
import { TOKEN_REGISTRY } from '../market/native-tokens';

type GeckoTerminalResponse = {
  data?: {
    id?: string;
    attributes?: {
      name?: string;
      address?: string;
      dex_name?: string;
      reserve_in_usd?: string;
      volume_usd?: {
        h24?: string;
      };
    };
    relationships?: {
      quote_token?: {
        data?: {
          id?: string;
        };
      };
    };
  };
};

type GeckoTerminalPoolListResponse = {
  data?: Array<{
    id?: string;
    attributes?: {
      name?: string;
      address?: string;
      reserve_in_usd?: string;
      volume_usd?: {
        h24?: string;
      };
    };
  }>;
};

type LiquiditySample = {
  atMs: number;
  liquidityUsd: number;
};

type CoinGeckoTickerResponse = {
  tickers?: Array<{
    base?: string;
    target?: string;
    market?: {
      name?: string;
      identifier?: string;
    };
    bid_ask_spread_percentage?: unknown;
    converted_volume?: {
      usd?: unknown;
    };
  }>;
};

type NormalizedLiquidityData = {
  quoteToken: LiquiditySnapshot['quoteToken'];
  hasUsdtOrUsdcPair: boolean;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceImpact1kPct: number | null;
  rugpullRiskSignal: LiquiditySnapshot['rugpullRiskSignal'];
  warnings: string[];
  sourceUsed: LiquiditySnapshot['sourceUsed'];
  degradeReason?: string;
  isLpLocked: boolean | null;
  lpLockRatioPct: number | null;
  topVenues: LiquidityVenueSnapshot[];
  primaryVenue: LiquidityVenueSnapshot | null;
  venueCount: number | null;
};

@Injectable()
export class LiquidityService {
  readonly moduleName = 'liquidity';
  private readonly logger = new Logger(LiquidityService.name);
  private readonly liquidityHistory = new Map<string, LiquiditySample[]>();
  private readonly oneHourMs = 60 * 60 * 1000;
  private readonly historyWindowMs = 6 * 60 * 60 * 1000;

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<LiquiditySnapshot> {
    const nowMs = Date.now();
    const pairKey = this.buildLiquidityKey(identity);

    const nativeProxy = this.shouldUseNativeProxy(identity)
      ? await this.fetchNativeAssetProxy(identity)
      : null;
    const poolData = nativeProxy ?? (await this.fetchGeckoTerminalPool(identity));
    if (!poolData) {
      return this.buildUnavailableSnapshot('LIQUIDITY_SOURCE_NOT_FOUND');
    }

    const liquidityUsd = poolData.liquidityUsd;
    const volume24hUsd = poolData.volume24hUsd;
    const quoteToken = poolData.quoteToken;
    const hasUsdtOrUsdcPair = poolData.hasUsdtOrUsdcPair;

    const liquidity1hAgoUsd = this.pickOneHourAgoLiquidity(pairKey, nowMs);
    const liquidityDrop1hPct = this.calculateLiquidityDropPct(
      liquidityUsd,
      liquidity1hAgoUsd,
    );
    const dropThresholdPct = Number(
      process.env.LIQUIDITY_DROP_ALERT_PCT ?? -20,
    );
    const withdrawalRiskFlag =
      typeof liquidityDrop1hPct === 'number' &&
      liquidityDrop1hPct <= dropThresholdPct;

    const warnings: string[] = [...poolData.warnings];
    if (!hasUsdtOrUsdcPair) {
      warnings.push(
        'Quote token is not USDT/USDC; liquidity quality may be lower.',
      );
    }
    if (liquidity1hAgoUsd === null) {
      warnings.push(
        '1h liquidity baseline is not ready yet (warm-up in progress).',
      );
    }
    if (typeof liquidityUsd === 'number' && liquidityUsd < 200000) {
      warnings.push('Liquidity is thin; slippage may be significant.');
    }
    if (withdrawalRiskFlag) {
      warnings.push('Rapid liquidity drop detected in short time window.');
    }

    const rugpullRiskSignal = this.deriveRugpullRiskSignal({
      liquidityUsd,
      liquidityDrop1hPct,
      withdrawalRiskFlag,
      sourceUsed: poolData.sourceUsed,
      suggested: poolData.rugpullRiskSignal,
    });
    const priceImpact1kPct =
      poolData.priceImpact1kPct ?? this.estimatePriceImpact1kPct(liquidityUsd);

    const isLpLocked = poolData.isLpLocked;
    const lpLockRatioPct = poolData.lpLockRatioPct;

    const degraded = liquidityUsd === null || volume24hUsd === null;
    const degradeReason =
      liquidityUsd === null
        ? poolData.degradeReason ?? 'LIQUIDITY_USD_MISSING'
        : volume24hUsd === null
          ? poolData.degradeReason ?? 'LIQUIDITY_VOLUME_24H_MISSING'
          : undefined;

    if (typeof liquidityUsd === 'number') {
      this.pushLiquiditySample(pairKey, nowMs, liquidityUsd);
    }

    return {
      quoteToken,
      hasUsdtOrUsdcPair,
      liquidityUsd,
      liquidity1hAgoUsd,
      liquidityDrop1hPct,
      withdrawalRiskFlag,
      volume24hUsd,
      priceImpact1kPct,
      topVenues: poolData.topVenues,
      primaryVenue: poolData.primaryVenue,
      venueCount: poolData.venueCount,
      isLpLocked,
      lpLockRatioPct,
      rugpullRiskSignal,
      warnings,
      asOf: new Date(nowMs).toISOString(),
      sourceUsed: poolData.sourceUsed,
      degraded,
      degradeReason,
    };
  }

  private async fetchGeckoTerminalPool(
    identity: AnalyzeIdentity,
  ): Promise<NormalizedLiquidityData | null> {
    const network = this.mapChainToGeckoNetwork(identity.chain);
    if (!network) {
      this.logger.warn(
        `Chain ${identity.chain} not supported by GeckoTerminal`,
      );
      return null;
    }

    const poolCandidates = await this.findTopPools(network, identity.tokenAddress);
    if (poolCandidates.length === 0) {
      return null;
    }
    const detailedPools = (
      await Promise.all(
        poolCandidates
          .slice(0, 3)
          .map((pool) => this.fetchGeckoTerminalPoolDetail(network, pool, identity)),
      )
    ).filter((pool): pool is LiquidityVenueSnapshot => pool !== null);
    const topVenues =
      detailedPools.length > 0
        ? detailedPools
        : poolCandidates.slice(0, 3).map((pool) => ({
            venueType: 'dex_pool' as const,
            venueName: null,
            pairLabel: pool.name?.trim() || `${identity.symbol}/unknown`,
            quoteToken: null,
            liquidityUsd: pool.liquidityUsd,
            volume24hUsd: pool.volume24hUsd,
            priceImpact1kPct: this.estimatePriceImpact1kPct(pool.liquidityUsd),
            marketSharePct: pool.marketSharePct,
            sourceId: pool.poolAddress,
          }));
    const primaryVenue = topVenues[0] ?? null;
    const normalizedQuote = this.normalizeQuoteToken(primaryVenue?.quoteToken);

    return {
      quoteToken: normalizedQuote,
      hasUsdtOrUsdcPair:
        topVenues.some((venue) => this.normalizeQuoteToken(venue.quoteToken) !== 'OTHER') ||
        normalizedQuote !== 'OTHER',
      liquidityUsd: primaryVenue?.liquidityUsd ?? poolCandidates[0]?.liquidityUsd ?? null,
      volume24hUsd:
        primaryVenue?.volume24hUsd ??
        poolCandidates[0]?.volume24hUsd ??
        null,
      priceImpact1kPct:
        primaryVenue?.priceImpact1kPct ??
        this.estimatePriceImpact1kPct(primaryVenue?.liquidityUsd ?? null),
      rugpullRiskSignal: 'unknown',
      warnings: [],
      sourceUsed: 'geckoterminal',
      isLpLocked: null,
      lpLockRatioPct: null,
      topVenues,
      primaryVenue,
      venueCount: poolCandidates.length,
    };
  }

  private async fetchNativeAssetProxy(
    identity: AnalyzeIdentity,
  ): Promise<NormalizedLiquidityData | null> {
    const coinId = this.resolveCoinGeckoCoinId(identity);
    if (!coinId) {
      return null;
    }

    const baseUrl = this.getCoinGeckoBaseUrl();
    const timeoutMs = this.getCoinGeckoTimeoutMs();
    const params = new URLSearchParams({
      include_exchange_logo: 'false',
      page: '1',
      order: 'volume_desc',
    });
    const response = await this.fetchJson<CoinGeckoTickerResponse>(
      `${baseUrl}/coins/${encodeURIComponent(coinId)}/tickers?${params.toString()}`,
      timeoutMs,
      this.buildCoinGeckoHeaders(),
    );
    if (!response || !Array.isArray(response.tickers)) {
      return null;
    }

    const tickers = response.tickers
      .map((ticker) => {
        const target = (ticker.target ?? '').trim().toUpperCase();
        const volumeUsd = this.toNumber(ticker.converted_volume?.usd);
        const spreadPct = this.toNumber(ticker.bid_ask_spread_percentage);
        return {
          base: (ticker.base ?? identity.symbol).trim().toUpperCase(),
          target,
          market: {
            name: ticker.market?.name?.trim() || undefined,
            identifier: ticker.market?.identifier?.trim() || undefined,
          },
          volumeUsd,
          spreadPct,
          stable:
            target === 'USDT' || target === 'USDC' || target === 'USD',
        };
      })
      .filter((ticker) => ticker.volumeUsd !== null && ticker.volumeUsd > 0);

    if (tickers.length === 0) {
      return null;
    }

    const ranked = tickers.sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
    const preferred = ranked.filter((ticker) => ticker.stable);
    const selected = (preferred.length > 0 ? preferred : ranked).slice(0, 10);
    const topDepth = selected.slice(0, 5);
    const liquidityUsd = this.round(
      topDepth.reduce((sum, ticker) => sum + (ticker.volumeUsd ?? 0), 0),
      2,
    );
    const volume24hUsd = this.round(
      selected.reduce((sum, ticker) => sum + (ticker.volumeUsd ?? 0), 0),
      2,
    );
    const spreadSamples = selected
      .map((ticker) => ticker.spreadPct)
      .filter((value): value is number => value !== null && value >= 0);
    const avgSpreadPct =
      spreadSamples.length > 0
        ? spreadSamples.reduce((sum, value) => sum + value, 0) /
          spreadSamples.length
        : null;
    const quoteToken: LiquiditySnapshot['quoteToken'] =
      preferred.some((ticker) => ticker.target === 'USDT')
        ? 'USDT'
        : preferred.some((ticker) => ticker.target === 'USDC')
          ? 'USDC'
          : 'OTHER';
    const topVenues = selected.slice(0, 5).map((ticker) => ({
      venueType: 'cex_market' as const,
      venueName: ticker.market?.name?.trim() || null,
      pairLabel: `${(ticker.base ?? identity.symbol).trim().toUpperCase()}/${ticker.target}`,
      quoteToken: ticker.target || null,
      liquidityUsd: ticker.volumeUsd,
      volume24hUsd: ticker.volumeUsd,
      priceImpact1kPct:
        ticker.spreadPct !== null ? Number(ticker.spreadPct.toFixed(4)) : null,
      marketSharePct:
        volume24hUsd && ticker.volumeUsd
          ? Number(((ticker.volumeUsd / volume24hUsd) * 100).toFixed(2))
          : null,
      sourceId: ticker.market?.identifier?.trim() || null,
    }));
    const primaryVenue = topVenues[0] ?? null;

    const warnings = [
      'Native-asset liquidity uses CoinGecko centralized-exchange ticker volume proxy instead of on-chain pool reserve.',
    ];
    if (preferred.length === 0) {
      warnings.push(
        'No dominant USDT/USDC market was found in the top ticker set.',
      );
    }
    if (avgSpreadPct !== null && avgSpreadPct > 0.2) {
      warnings.push(
        `Average bid/ask spread is elevated at ${avgSpreadPct.toFixed(3)}%.`,
      );
    }

    return {
      quoteToken,
      hasUsdtOrUsdcPair: preferred.some(
        (ticker) => ticker.target === 'USDT' || ticker.target === 'USDC',
      ),
      liquidityUsd,
      volume24hUsd,
      priceImpact1kPct:
        avgSpreadPct !== null ? Number(avgSpreadPct.toFixed(4)) : null,
      rugpullRiskSignal: 'low',
      warnings,
      sourceUsed: 'coingecko',
      isLpLocked: null,
      lpLockRatioPct: null,
      topVenues,
      primaryVenue,
      venueCount: tickers.length,
      degradeReason:
        liquidityUsd === null
          ? 'LIQUIDITY_PROXY_VOLUME_MISSING'
          : volume24hUsd === null
            ? 'LIQUIDITY_PROXY_VOLUME_24H_MISSING'
            : undefined,
    };
  }

  private async findTopPools(
    network: string,
    tokenAddress: string,
  ): Promise<
    Array<{
      id: string;
      poolAddress: string;
      name: string | null;
      liquidityUsd: number | null;
      volume24hUsd: number | null;
      marketSharePct: number | null;
    }>
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}/pools`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as GeckoTerminalPoolListResponse;

      const pools = payload.data ?? [];
      if (pools.length === 0) {
        return [];
      }

      const totalLiquidity = pools.reduce(
        (sum, pool) =>
          sum + (this.parseGeckoNumber(pool.attributes?.reserve_in_usd) ?? 0),
        0,
      );
      return pools
        .map((pool) => ({
          id: pool.id ?? '',
          poolAddress: pool.attributes?.address ?? pool.id?.split('_').pop() ?? '',
          name: pool.attributes?.name?.trim() || null,
          liquidityUsd: this.parseGeckoNumber(pool.attributes?.reserve_in_usd),
          volume24hUsd: this.parseGeckoNumber(pool.attributes?.volume_usd?.h24),
          marketSharePct:
            totalLiquidity > 0
              ? Number(
                  (
                    ((this.parseGeckoNumber(pool.attributes?.reserve_in_usd) ?? 0) /
                      totalLiquidity) *
                    100
                  ).toFixed(2),
                )
              : null,
        }))
        .filter((pool) => pool.id && pool.poolAddress)
        .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchGeckoTerminalPoolDetail(
    network: string,
    pool: {
      poolAddress: string;
      name: string | null;
      liquidityUsd: number | null;
      volume24hUsd: number | null;
      marketSharePct: number | null;
    },
    identity: AnalyzeIdentity,
  ): Promise<LiquidityVenueSnapshot | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool.poolAddress}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        this.logger.warn(
          `GeckoTerminal pool query failed (${response.status}) for ${identity.symbol}`,
        );
        return null;
      }

      const payload = (await response.json()) as GeckoTerminalResponse;
      const attrs = payload.data?.attributes;
      if (!attrs) {
        return null;
      }

      const quoteTokenId = payload.data?.relationships?.quote_token?.data?.id;
      const quoteSymbol = quoteTokenId?.split('_').pop() ?? null;
      const liquidityUsd =
        this.parseGeckoNumber(attrs.reserve_in_usd) ?? pool.liquidityUsd;
      return {
        venueType: 'dex_pool',
        venueName: attrs.dex_name?.trim() || null,
        pairLabel:
          attrs.name?.trim() ||
          pool.name?.trim() ||
          `${identity.symbol}/${quoteSymbol ?? 'unknown'}`,
        quoteToken: quoteSymbol?.toUpperCase() ?? null,
        liquidityUsd,
        volume24hUsd:
          this.parseGeckoNumber(attrs.volume_usd?.h24) ?? pool.volume24hUsd,
        priceImpact1kPct: this.estimatePriceImpact1kPct(liquidityUsd),
        marketSharePct: pool.marketSharePct,
        sourceId: attrs.address?.trim() || pool.poolAddress,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`GeckoTerminal request failed: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapChainToGeckoNetwork(chain: string): string | null {
    const normalized = this.normalizeChain(chain);
    const mapping: Record<string, string> = {
      ethereum: 'eth',
      bsc: 'bsc',
      polygon: 'polygon_pos',
      arbitrum: 'arbitrum',
      avalanche: 'avax',
      base: 'base',
      optimism: 'optimism',
      solana: 'solana',
    };
    return mapping[normalized] ?? null;
  }

  private parseGeckoNumber(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeQuoteToken(
    value: string | null | undefined,
  ): LiquiditySnapshot['quoteToken'] {
    const normalized = value?.trim().toUpperCase();
    if (normalized === 'USDT') {
      return 'USDT';
    }
    if (normalized === 'USDC') {
      return 'USDC';
    }
    return 'OTHER';
  }

  private pickOneHourAgoLiquidity(key: string, nowMs: number): number | null {
    const samples = this.liquidityHistory.get(key) ?? [];
    if (samples.length === 0) {
      return null;
    }
    const targetMs = nowMs - this.oneHourMs;
    let candidate: LiquiditySample | null = null;
    for (const sample of samples) {
      if (
        sample.atMs <= targetMs &&
        (!candidate || sample.atMs > candidate.atMs)
      ) {
        candidate = sample;
      }
    }
    return candidate?.liquidityUsd ?? null;
  }

  private pushLiquiditySample(
    key: string,
    atMs: number,
    liquidityUsd: number,
  ): void {
    const existing = this.liquidityHistory.get(key) ?? [];
    const pruned = existing.filter(
      (item) => atMs - item.atMs <= this.historyWindowMs,
    );
    pruned.push({
      atMs,
      liquidityUsd,
    });
    this.liquidityHistory.set(key, pruned);
  }

  private calculateLiquidityDropPct(
    liquidityUsd: number | null,
    liquidity1hAgoUsd: number | null,
  ): number | null {
    if (
      typeof liquidityUsd !== 'number' ||
      typeof liquidity1hAgoUsd !== 'number' ||
      liquidity1hAgoUsd <= 0
    ) {
      return null;
    }
    const raw = ((liquidityUsd - liquidity1hAgoUsd) / liquidity1hAgoUsd) * 100;
    return Number(raw.toFixed(2));
  }

  private estimatePriceImpact1kPct(liquidityUsd: number | null): number | null {
    if (typeof liquidityUsd !== 'number' || liquidityUsd <= 0) {
      return null;
    }
    const estimated = (1000 / liquidityUsd) * 100;
    return Number(estimated.toFixed(4));
  }

  private deriveRugpullRiskSignal(input: {
    liquidityUsd: number | null;
    liquidityDrop1hPct: number | null;
    withdrawalRiskFlag: boolean;
    sourceUsed?: LiquiditySnapshot['sourceUsed'];
    suggested?: LiquiditySnapshot['rugpullRiskSignal'];
  }): LiquiditySnapshot['rugpullRiskSignal'] {
    if (input.sourceUsed === 'coingecko') {
      return input.suggested ?? 'low';
    }
    if (typeof input.liquidityUsd !== 'number') {
      return 'unknown';
    }
    if (
      input.withdrawalRiskFlag &&
      (input.liquidityUsd < 100000 ||
        (typeof input.liquidityDrop1hPct === 'number' &&
          input.liquidityDrop1hPct <= -40))
    ) {
      return 'critical';
    }
    if (input.withdrawalRiskFlag) {
      return 'high';
    }
    if (
      input.liquidityUsd < 300000 ||
      (typeof input.liquidityDrop1hPct === 'number' &&
        input.liquidityDrop1hPct <= -10)
    ) {
      return 'medium';
    }
    return 'low';
  }

  private buildUnavailableSnapshot(reason: string): LiquiditySnapshot {
    return {
      quoteToken: 'OTHER',
      hasUsdtOrUsdcPair: false,
      liquidityUsd: null,
      liquidity1hAgoUsd: null,
      liquidityDrop1hPct: null,
      withdrawalRiskFlag: false,
      volume24hUsd: null,
      priceImpact1kPct: null,
      topVenues: [],
      primaryVenue: null,
      venueCount: 0,
      isLpLocked: null,
      lpLockRatioPct: null,
      rugpullRiskSignal: 'unknown',
      warnings: ['Liquidity source is unavailable for this token.'],
      asOf: new Date().toISOString(),
      sourceUsed: 'liquidity_unavailable',
      degraded: true,
      degradeReason: reason,
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
      op: 'optimism',
      optimism: 'optimism',
    };
    return aliases[normalized] ?? normalized;
  }

  private shouldUseNativeProxy(identity: AnalyzeIdentity): boolean {
    const symbol = identity.symbol.trim().toUpperCase();
    const meta = TOKEN_REGISTRY[symbol];
    return Boolean(meta && meta.hasContract === false && !identity.tokenAddress.trim());
  }

  private buildLiquidityKey(identity: AnalyzeIdentity): string {
    if (this.shouldUseNativeProxy(identity)) {
      return `native:${this.resolveCoinGeckoCoinId(identity) ?? identity.symbol.toUpperCase()}`;
    }
    return `${this.normalizeChain(identity.chain)}:${identity.tokenAddress.toLowerCase()}`;
  }

  private resolveCoinGeckoCoinId(identity: AnalyzeIdentity): string | null {
    const symbol = identity.symbol.trim().toUpperCase();
    const meta = TOKEN_REGISTRY[symbol];
    if (meta?.coinId?.trim()) {
      return meta.coinId.trim();
    }
    const match = identity.sourceId.match(/^coingecko:(.+)$/);
    return match?.[1]?.trim() || null;
  }

  private getCoinGeckoBaseUrl(): string {
    const raw =
      process.env.COINGECKO_API_BASE_URL ??
      'https://pro-api.coingecko.com/api/v3';
    const value = raw.trim();
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  private buildCoinGeckoHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const apiKey =
      process.env.COINGECKO_ACCESS_KEY ?? process.env.COINGECKO_API_KEY;
    if (!apiKey?.trim()) {
      return headers;
    }
    if (this.getCoinGeckoBaseUrl().includes('pro-api.coingecko.com')) {
      headers['x-cg-pro-api-key'] = apiKey.trim();
    } else {
      headers['x-cg-demo-api-key'] = apiKey.trim();
    }
    return headers;
  }

  private getCoinGeckoTimeoutMs(): number {
    const configured = Number(
      process.env.COINGECKO_LIQUIDITY_TIMEOUT_MS ??
        process.env.COINGECKO_TIMEOUT_MS ??
        5000,
    );
    return Number.isFinite(configured) ? Math.max(configured, 12000) : 12000;
  }

  private async fetchJson<T>(
    url: string,
    timeoutMs: number,
    headers: Record<string, string>,
  ): Promise<T | null> {
    const attempts = Math.max(
      1,
      Number(process.env.COINGECKO_LIQUIDITY_RETRY_ATTEMPTS ?? 3),
    );

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers,
        });
        if (!response.ok) {
          this.logger.warn(
            `Liquidity proxy request failed (${response.status}) for ${url}`,
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
          `Liquidity proxy request unavailable for ${url}${retryable ? ` (attempt ${attempt}/${attempts})` : ''}: ${message}`,
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

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private round(value: number | null, digits: number): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(digits));
  }

}

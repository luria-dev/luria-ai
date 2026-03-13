import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  LiquiditySnapshot,
} from '../../../data/contracts/analyze-contracts';

type CmcDexPair = {
  pairAddress?: string;
  quoteToken?: {
    symbol?: string;
  };
  quote_token_symbol?: string;
  liquidity?: {
    usd?: number | string;
  };
  liquidity_usd?: number | string;
  volume?: {
    h24?: number | string;
  };
  volume_24h?: number | string;
};

type CmcDexResponse = {
  data?: unknown;
};

type LiquiditySample = {
  atMs: number;
  liquidityUsd: number;
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
    const pairs = await this.fetchCmcDexPairs(identity);
    const pair = this.pickBestPair(pairs);
    if (!pair) {
      return this.buildUnavailableSnapshot('LIQUIDITY_SOURCE_NOT_FOUND');
    }

    const nowMs = Date.now();
    const pairKey = `${this.normalizeChain(identity.chain)}:${identity.tokenAddress.toLowerCase()}`;
    const liquidityUsd = this.toNullableNumber(
      pair.liquidity?.usd ?? pair.liquidity_usd,
    );
    const volume24hUsd = this.toNullableNumber(
      pair.volume?.h24 ?? pair.volume_24h,
    );
    const quoteSymbol = (
      pair.quoteToken?.symbol ??
      pair.quote_token_symbol ??
      'OTHER'
    ).toUpperCase();
    const quoteToken: LiquiditySnapshot['quoteToken'] =
      quoteSymbol === 'USDT' || quoteSymbol === 'USDC' ? quoteSymbol : 'OTHER';
    const hasUsdtOrUsdcPair = quoteToken === 'USDT' || quoteToken === 'USDC';

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

    const warnings: string[] = [];
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
    });
    const priceImpact1kPct = this.estimatePriceImpact1kPct(liquidityUsd);

    const degraded = liquidityUsd === null || volume24hUsd === null;
    const degradeReason =
      liquidityUsd === null
        ? 'LIQUIDITY_USD_MISSING'
        : volume24hUsd === null
          ? 'LIQUIDITY_VOLUME_24H_MISSING'
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
      isLpLocked: null,
      lpLockRatioPct: null,
      rugpullRiskSignal,
      warnings,
      asOf: new Date(nowMs).toISOString(),
      sourceUsed: 'cmc_dex',
      degraded,
      degradeReason,
    };
  }

  private async fetchCmcDexPairs(
    identity: AnalyzeIdentity,
  ): Promise<CmcDexPair[]> {
    const baseUrl =
      process.env.COINMARKETCAP_API_BASE_URL ??
      'https://pro-api.coinmarketcap.com';
    const path =
      process.env.CMC_DEX_PAIRS_PATH ?? '/v4/dex/pairs/quotes/latest';
    const timeoutMs = Number(process.env.COINMARKETCAP_TIMEOUT_MS ?? 5000);
    const chain = this.normalizeChain(identity.chain);

    const template = process.env.CMC_DEX_PAIRS_URL_TEMPLATE;
    const url = template?.trim()
      ? template
          .replaceAll('{chain}', encodeURIComponent(chain))
          .replaceAll(
            '{tokenAddress}',
            encodeURIComponent(identity.tokenAddress),
          )
      : `${baseUrl}${path}?network=${encodeURIComponent(chain)}&contract_address=${encodeURIComponent(identity.tokenAddress)}`;

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
          `CMC DEX pair fetch failed (${response.status}) for ${chain}:${identity.tokenAddress}.`,
        );
        return [];
      }

      const body = (await response.json()) as CmcDexResponse;
      return this.extractPairs(body.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CMC DEX pair fetch unavailable for ${chain}:${identity.tokenAddress}: ${message}`,
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractPairs(data: unknown): CmcDexPair[] {
    if (!data) {
      return [];
    }
    if (Array.isArray(data)) {
      return data.filter((item): item is CmcDexPair =>
        Boolean(item && typeof item === 'object'),
      );
    }
    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const candidates = [obj.pairs, obj.items, obj.list, obj.rows, obj.data];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return candidate.filter((item): item is CmcDexPair =>
            Boolean(item && typeof item === 'object'),
          );
        }
      }
      if (
        'liquidity' in obj ||
        'liquidity_usd' in obj ||
        'volume' in obj ||
        'volume_24h' in obj
      ) {
        return [obj as CmcDexPair];
      }
    }
    return [];
  }

  private pickBestPair(pairs: CmcDexPair[]): CmcDexPair | null {
    if (pairs.length === 0) {
      return null;
    }
    const scored = pairs
      .map((pair) => ({
        pair,
        liquidity:
          this.toNullableNumber(pair.liquidity?.usd ?? pair.liquidity_usd) ??
          -1,
      }))
      .sort((a, b) => b.liquidity - a.liquidity);
    return scored[0]?.pair ?? null;
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
  }): LiquiditySnapshot['rugpullRiskSignal'] {
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

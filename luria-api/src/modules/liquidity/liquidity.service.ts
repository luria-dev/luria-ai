import { Injectable, Logger } from '@nestjs/common';
import { AnalyzeIdentity, LiquiditySnapshot } from '../../core/contracts/analyze-contracts';

type DexScreenerPair = {
  chainId?: string;
  pairAddress?: string;
  quoteToken?: {
    symbol?: string;
  };
  liquidity?: {
    usd?: number | string;
  };
  volume?: {
    h24?: number | string;
  };
};

type DexScreenerPairResponse = {
  pair?: DexScreenerPair;
  pairs?: DexScreenerPair[];
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
    const pair = await this.fetchDexScreenerPair(identity.chain, identity.pairAddress);
    if (!pair) {
      return this.buildUnavailableSnapshot('LIQUIDITY_SOURCE_NOT_FOUND');
    }

    const nowMs = Date.now();
    const resolvedPairAddress = (identity.pairAddress || pair.pairAddress || '').trim();
    if (!resolvedPairAddress) {
      return this.buildUnavailableSnapshot('PAIR_ADDRESS_MISSING');
    }

    const resolvedChain = this.normalizeChain(identity.chain);
    const pairKey = `${resolvedChain}:${resolvedPairAddress.toLowerCase()}`;
    const liquidityUsd = this.toNullableNumber(pair.liquidity?.usd);
    const volume24hUsd = this.toNullableNumber(pair.volume?.h24);
    const quoteSymbol = (pair.quoteToken?.symbol ?? identity.quoteToken ?? 'OTHER').toUpperCase();
    const quoteToken: LiquiditySnapshot['quoteToken'] =
      quoteSymbol === 'USDT' || quoteSymbol === 'USDC' ? quoteSymbol : 'OTHER';
    const hasUsdtOrUsdcPair = quoteToken === 'USDT' || quoteToken === 'USDC';

    const liquidity1hAgoUsd = this.pickOneHourAgoLiquidity(pairKey, nowMs);
    const liquidityDrop1hPct = this.calculateLiquidityDropPct(liquidityUsd, liquidity1hAgoUsd);
    const dropThresholdPct = Number(process.env.LIQUIDITY_DROP_ALERT_PCT ?? -20);
    const withdrawalRiskFlag =
      typeof liquidityDrop1hPct === 'number' && liquidityDrop1hPct <= dropThresholdPct;

    const warnings: string[] = [];
    if (!hasUsdtOrUsdcPair) {
      warnings.push('Quote token is not USDT/USDC; liquidity quality may be lower.');
    }
    if (liquidity1hAgoUsd === null) {
      warnings.push('1h liquidity baseline is not ready yet (warm-up in progress).');
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
      pairAddress: resolvedPairAddress,
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
      sourceUsed: 'dexscreener',
      degraded,
      degradeReason,
    };
  }

  private async fetchDexScreenerPair(
    chain: string,
    pairAddress: string,
  ): Promise<DexScreenerPair | null> {
    const baseUrl = process.env.DEXSCREENER_PAIR_URL ?? 'https://api.dexscreener.com/latest/dex/pairs';
    const timeoutMs = Number(process.env.DEXSCREENER_TIMEOUT_MS ?? 5000);
    const chainId = this.normalizeChain(chain);
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

  private pickOneHourAgoLiquidity(pairKey: string, nowMs: number): number | null {
    const samples = this.liquidityHistory.get(pairKey) ?? [];
    if (samples.length === 0) {
      return null;
    }
    const targetMs = nowMs - this.oneHourMs;
    let candidate: LiquiditySample | null = null;
    for (const sample of samples) {
      if (sample.atMs <= targetMs && (!candidate || sample.atMs > candidate.atMs)) {
        candidate = sample;
      }
    }
    return candidate?.liquidityUsd ?? null;
  }

  private pushLiquiditySample(pairKey: string, atMs: number, liquidityUsd: number): void {
    const existing = this.liquidityHistory.get(pairKey) ?? [];
    const pruned = existing.filter((item) => atMs - item.atMs <= this.historyWindowMs);
    pruned.push({
      atMs,
      liquidityUsd,
    });
    this.liquidityHistory.set(pairKey, pruned);
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
        (typeof input.liquidityDrop1hPct === 'number' && input.liquidityDrop1hPct <= -40))
    ) {
      return 'critical';
    }
    if (input.withdrawalRiskFlag) {
      return 'high';
    }
    if (
      input.liquidityUsd < 300000 ||
      (typeof input.liquidityDrop1hPct === 'number' && input.liquidityDrop1hPct <= -10)
    ) {
      return 'medium';
    }
    return 'low';
  }

  private buildUnavailableSnapshot(reason: string): LiquiditySnapshot {
    return {
      quoteToken: 'OTHER',
      hasUsdtOrUsdcPair: false,
      pairAddress: null,
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

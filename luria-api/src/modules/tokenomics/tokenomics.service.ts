import { Injectable, Logger } from '@nestjs/common';
import { AnalyzeIdentity, TokenomicsSnapshot, VestingItem } from '../../core/contracts/analyze-contracts';

type CoinGeckoContractResponse = {
  market_data?: {
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
  };
};

type TokenomistUnlockItem = {
  bucket?: string;
  start?: string;
  cliffMonths?: number;
  unlockFrequency?: string;
  end?: string;
};

@Injectable()
export class TokenomicsService {
  readonly moduleName = 'tokenomics';
  private readonly logger = new Logger(TokenomicsService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<TokenomicsSnapshot> {
    const [coingecko, tokenomist] = await Promise.all([
      this.fetchFromCoinGecko(identity),
      this.fetchFromTokenomist(identity),
    ]);

    const sourceUsed: TokenomicsSnapshot['sourceUsed'] = [];
    const evidence: TokenomicsSnapshot['evidence'] = [];
    const vestingSchedule: VestingItem[] = [];
    const nowIso = new Date().toISOString();

    let inflationRate: TokenomicsSnapshot['inflationRate'] = {
      currentAnnualPct: null,
      targetAnnualPct: null,
      isDynamic: false,
    };

    if (coingecko) {
      sourceUsed.push('coingecko');
      evidence.push({
        field: 'supply.circulating',
        sourceName: 'coingecko',
        sourceUrl: coingecko.sourceUrl,
        extractedAt: nowIso,
      });
      evidence.push({
        field: 'supply.total',
        sourceName: 'coingecko',
        sourceUrl: coingecko.sourceUrl,
        extractedAt: nowIso,
      });
      if (coingecko.inflationRateCurrentAnnualPct !== null) {
        inflationRate = {
          currentAnnualPct: coingecko.inflationRateCurrentAnnualPct,
          targetAnnualPct: null,
          isDynamic: true,
        };
      }
    }

    if (tokenomist && tokenomist.length > 0) {
      sourceUsed.push('tokenomist');
      for (const item of tokenomist) {
        vestingSchedule.push(item);
      }
      evidence.push({
        field: 'vestingSchedule',
        sourceName: 'tokenomist',
        sourceUrl: process.env.TOKENOMIST_UNLOCKS_URL ?? 'https://tokenomist.ai',
        extractedAt: nowIso,
      });
    }

    const allocation: TokenomicsSnapshot['allocation'] = {
      teamPct: null,
      investorPct: null,
      communityPct: coingecko?.circulatingPctOfTotalSupply ?? null,
      foundationPct: null,
    };

    const tokenomicsEvidenceInsufficient =
      sourceUsed.length === 0 ||
      (allocation.teamPct === null &&
        allocation.investorPct === null &&
        allocation.foundationPct === null &&
        vestingSchedule.length === 0 &&
        inflationRate.currentAnnualPct === null);

    return {
      allocation,
      vestingSchedule,
      inflationRate,
      evidence,
      evidenceConflicts: [],
      asOf: nowIso,
      sourceUsed,
      degraded: tokenomicsEvidenceInsufficient,
      degradeReason: tokenomicsEvidenceInsufficient
        ? sourceUsed.length === 0
          ? 'TOKENOMICS_SOURCE_NOT_FOUND'
          : 'TOKENOMICS_EVIDENCE_PARTIAL'
        : undefined,
      tokenomicsEvidenceInsufficient,
    };
  }

  private async fetchFromCoinGecko(identity: AnalyzeIdentity): Promise<{
    circulatingPctOfTotalSupply: number | null;
    inflationRateCurrentAnnualPct: number | null;
    sourceUrl: string;
  } | null> {
    const platform = this.toCoinGeckoPlatform(identity.chain);
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
      if (apiKey?.trim()) {
        headers['x-cg-pro-api-key'] = apiKey.trim();
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        this.logger.warn(`CoinGecko tokenomics fetch failed (${response.status}) for ${identity.symbol}.`);
        return null;
      }
      const body = (await response.json()) as CoinGeckoContractResponse;
      const circulating = this.toNumber(body.market_data?.circulating_supply);
      const total = this.toNumber(body.market_data?.total_supply);
      const max = this.toNumber(body.market_data?.max_supply);

      const circulatingPctOfTotalSupply =
        circulating !== null && total !== null && total > 0
          ? Number(((circulating / total) * 100).toFixed(2))
          : null;
      const inflationRateCurrentAnnualPct =
        circulating !== null && max !== null && max > circulating
          ? Number((((max - circulating) / max) * 100).toFixed(2))
          : null;

      return {
        circulatingPctOfTotalSupply,
        inflationRateCurrentAnnualPct,
        sourceUrl: `https://www.coingecko.com/en/coins/${identity.symbol.toLowerCase()}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CoinGecko tokenomics unavailable for ${identity.symbol}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchFromTokenomist(identity: AnalyzeIdentity): Promise<VestingItem[]> {
    const baseUrl = process.env.TOKENOMIST_UNLOCKS_URL;
    if (!baseUrl || !baseUrl.trim()) {
      return [];
    }
    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const url =
      `${baseUrl}?symbol=${encodeURIComponent(identity.symbol)}` +
      `&token_address=${encodeURIComponent(identity.tokenAddress)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Tokenomist unlock fetch failed (${response.status}) for ${identity.symbol}.`);
        return [];
      }
      const body = (await response.json()) as unknown;
      const rows = Array.isArray(body)
        ? body
        : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).items)
          ? ((body as Record<string, unknown>).items as unknown[])
          : [];
      const parsed: VestingItem[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') {
          continue;
        }
        const item = row as TokenomistUnlockItem;
        const bucket = this.toString(item.bucket);
        const start = this.toDateString(item.start);
        const end = this.toDateString(item.end);
        const cliffMonths = this.toNumber(item.cliffMonths);
        const unlockFrequency = this.toUnlockFrequency(item.unlockFrequency);
        if (!bucket || !start || !end || cliffMonths === null || !unlockFrequency) {
          continue;
        }
        parsed.push({
          bucket,
          start,
          cliffMonths: Math.max(0, Math.round(cliffMonths)),
          unlockFrequency,
          end,
        });
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tokenomist unlock unavailable for ${identity.symbol}: ${message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
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

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace('%', '');
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

  private toString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return null;
  }

  private toDateString(value: unknown): string | null {
    const text = this.toString(value);
    if (!text) {
      return null;
    }
    const asDate = new Date(text);
    if (Number.isNaN(asDate.getTime())) {
      return null;
    }
    return asDate.toISOString().slice(0, 10);
  }

  private toUnlockFrequency(
    value: unknown,
  ): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null {
    const text = this.toString(value)?.toLowerCase();
    if (!text) {
      return null;
    }
    if (text.includes('day')) {
      return 'daily';
    }
    if (text.includes('week')) {
      return 'weekly';
    }
    if (text.includes('month')) {
      return 'monthly';
    }
    if (text.includes('quarter')) {
      return 'quarterly';
    }
    if (text.includes('year')) {
      return 'yearly';
    }
    return null;
  }
}

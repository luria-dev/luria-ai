import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  TokenomicsSnapshot,
  VestingItem,
} from '../../../data/contracts/analyze-contracts';

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
    const [allocation, vestingSchedule, inflationRate] = await Promise.all([
      this.fetchAllocation(identity),
      this.fetchUnlockSchedule(identity),
      this.fetchInflation(identity),
    ]);

    const nowIso = new Date().toISOString();
    const evidence: TokenomicsSnapshot['evidence'] = [];
    const sourceUsed: TokenomicsSnapshot['sourceUsed'] = [];

    if (allocation.found) {
      sourceUsed.push('tokenomist');
      evidence.push({
        field: 'allocation',
        sourceName: 'tokenomist',
        sourceUrl:
          process.env.TOKENOMIST_ALLOCATIONS_URL ?? 'https://tokenomist.ai',
        extractedAt: nowIso,
      });
    }

    if (vestingSchedule.length > 0) {
      if (sourceUsed.length === 0) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'vestingSchedule',
        sourceName: 'tokenomist',
        sourceUrl:
          process.env.TOKENOMIST_UNLOCKS_URL ?? 'https://tokenomist.ai',
        extractedAt: nowIso,
      });
    }

    if (
      inflationRate.currentAnnualPct !== null ||
      inflationRate.targetAnnualPct !== null
    ) {
      if (sourceUsed.length === 0) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'inflationRate',
        sourceName: 'tokenomist',
        sourceUrl:
          process.env.TOKENOMIST_EMISSION_URL ?? 'https://tokenomist.ai',
        extractedAt: nowIso,
      });
    }

    const tokenomicsEvidenceInsufficient =
      sourceUsed.length === 0 ||
      (allocation.value.teamPct === null &&
        allocation.value.investorPct === null &&
        allocation.value.foundationPct === null &&
        allocation.value.communityPct === null &&
        vestingSchedule.length === 0 &&
        inflationRate.currentAnnualPct === null &&
        inflationRate.targetAnnualPct === null);

    return {
      allocation: allocation.value,
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

  private async fetchAllocation(identity: AnalyzeIdentity): Promise<{
    found: boolean;
    value: TokenomicsSnapshot['allocation'];
  }> {
    const fallback: TokenomicsSnapshot['allocation'] = {
      teamPct: null,
      investorPct: null,
      communityPct: null,
      foundationPct: null,
    };

    const baseUrl = process.env.TOKENOMIST_ALLOCATIONS_URL;
    if (!baseUrl?.trim()) {
      return { found: false, value: fallback };
    }

    const body = await this.fetchTokenomist(baseUrl, identity, 'allocation');
    if (!body || typeof body !== 'object') {
      return { found: false, value: fallback };
    }

    const obj = body as Record<string, unknown>;
    const pickPct = (...keys: string[]): number | null => {
      for (const key of keys) {
        const parsed = this.toNumber(obj[key]);
        if (parsed !== null) {
          return Number(parsed.toFixed(2));
        }
      }
      return null;
    };

    const value: TokenomicsSnapshot['allocation'] = {
      teamPct: pickPct('teamPct', 'team', 'team_pct', 'allocation_team_pct'),
      investorPct: pickPct(
        'investorPct',
        'investors',
        'investor_pct',
        'allocation_investor_pct',
      ),
      communityPct: pickPct(
        'communityPct',
        'community',
        'community_pct',
        'allocation_community_pct',
      ),
      foundationPct: pickPct(
        'foundationPct',
        'foundation',
        'foundation_pct',
        'allocation_foundation_pct',
      ),
    };

    const found = Object.values(value).some((v) => typeof v === 'number');
    return { found, value };
  }

  private async fetchUnlockSchedule(
    identity: AnalyzeIdentity,
  ): Promise<VestingItem[]> {
    const baseUrl = process.env.TOKENOMIST_UNLOCKS_URL;
    if (!baseUrl?.trim()) {
      return [];
    }

    const body = await this.fetchTokenomist(baseUrl, identity, 'unlock');
    const rows = Array.isArray(body)
      ? body
      : body &&
          typeof body === 'object' &&
          Array.isArray((body as Record<string, unknown>).items)
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
      if (
        !bucket ||
        !start ||
        !end ||
        cliffMonths === null ||
        !unlockFrequency
      ) {
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
  }

  private async fetchInflation(
    identity: AnalyzeIdentity,
  ): Promise<TokenomicsSnapshot['inflationRate']> {
    const fallback: TokenomicsSnapshot['inflationRate'] = {
      currentAnnualPct: null,
      targetAnnualPct: null,
      isDynamic: false,
    };

    const baseUrl = process.env.TOKENOMIST_EMISSION_URL;
    if (!baseUrl?.trim()) {
      return fallback;
    }

    const body = await this.fetchTokenomist(baseUrl, identity, 'emission');
    if (!body || typeof body !== 'object') {
      return fallback;
    }

    const obj = body as Record<string, unknown>;
    const currentAnnualPct = this.toNumber(
      obj.currentAnnualPct ??
        obj.current_annual_pct ??
        obj.inflation_rate_current,
    );
    const targetAnnualPct = this.toNumber(
      obj.targetAnnualPct ?? obj.target_annual_pct ?? obj.inflation_rate_target,
    );
    const isDynamicRaw = obj.isDynamic ?? obj.is_dynamic ?? obj.dynamic;

    return {
      currentAnnualPct:
        currentAnnualPct !== null ? Number(currentAnnualPct.toFixed(2)) : null,
      targetAnnualPct:
        targetAnnualPct !== null ? Number(targetAnnualPct.toFixed(2)) : null,
      isDynamic: this.toBool(isDynamicRaw) ?? false,
    };
  }

  private async fetchTokenomist(
    baseUrl: string,
    identity: AnalyzeIdentity,
    label: string,
  ): Promise<unknown> {
    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const params = new URLSearchParams({
      symbol: identity.symbol,
      token_address: identity.tokenAddress,
    });
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `Tokenomist ${label} fetch failed (${response.status}) for ${identity.symbol}.`,
        );
        return null;
      }
      return (await response.json()) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Tokenomist ${label} unavailable for ${identity.symbol}: ${message}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
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

  private toBool(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no'].includes(normalized)) {
        return false;
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

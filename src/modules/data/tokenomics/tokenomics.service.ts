import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  TokenomicsSnapshot,
  VestingItem,
} from '../../../data/contracts/analyze-contracts';

type RootDataSearchResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataItemResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataTokenomicsResult = {
  allocation: TokenomicsSnapshot['allocation'];
  allocationFound: boolean;
  vestingSchedule: VestingItem[];
  inflationRate: TokenomicsSnapshot['inflationRate'];
};

type TokenomistTokenMeta = {
  tokenId: string | null;
  hasStandardAllocation: boolean | null;
  circulatingSupply: number | null;
  maxSupply: number | null;
  totalLockedAmount: number | null;
};

@Injectable()
export class TokenomicsService {
  readonly moduleName = 'tokenomics';
  private readonly logger = new Logger(TokenomicsService.name);
  private readonly tokenomistTokenIdCache = new Map<string, string | null>();
  private readonly tokenomistTokenMetaCache = new Map<
    string,
    TokenomistTokenMeta | null
  >();

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<TokenomicsSnapshot> {
    const tokenomistMeta = await this.resolveTokenomistTokenMeta(identity);
    const [
      tokenomistAllocation,
      tokenomistVesting,
      tokenomistInflation,
      tokenomistBurns,
      tokenomistBuybacks,
      tokenomistFundraising,
      rootdata,
    ] = await Promise.all([
      this.fetchAllocation(identity, tokenomistMeta),
      this.fetchUnlockSchedule(identity, tokenomistMeta),
      this.fetchInflation(identity, tokenomistMeta),
      this.fetchBurns(identity, tokenomistMeta),
      this.fetchBuybacks(identity, tokenomistMeta),
      this.fetchFundraising(identity, tokenomistMeta),
      this.fetchRootDataTokenomics(identity),
    ]);

    const hasTokenomistInflation =
      tokenomistInflation.currentAnnualPct !== null ||
      tokenomistInflation.targetAnnualPct !== null;

    const allocation = tokenomistAllocation.found
      ? tokenomistAllocation.value
      : rootdata?.allocationFound
        ? rootdata.allocation
        : tokenomistAllocation.value;

    const vestingSchedule =
      tokenomistVesting.length > 0
        ? tokenomistVesting
        : (rootdata?.vestingSchedule ?? []);

    const inflationRate = hasTokenomistInflation
      ? tokenomistInflation
      : (rootdata?.inflationRate ?? tokenomistInflation);

    const nowIso = new Date().toISOString();
    const evidence: TokenomicsSnapshot['evidence'] = [];
    const sourceUsed: TokenomicsSnapshot['sourceUsed'] = [];

    if (tokenomistAllocation.found) {
      sourceUsed.push('tokenomist');
      evidence.push({
        field: 'allocation',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistAllocationsUrl(),
        extractedAt: nowIso,
      });
    } else if (rootdata?.allocationFound) {
      sourceUsed.push('rootdata');
      evidence.push({
        field: 'allocation',
        sourceName: 'rootdata',
        sourceUrl: process.env.ROOTDATA_ITEM_URL ?? 'https://docs.rootdata.com',
        extractedAt: nowIso,
      });
    }

    if (tokenomistVesting.length > 0) {
      if (!sourceUsed.includes('tokenomist')) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'vestingSchedule',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistUnlocksUrl(),
        extractedAt: nowIso,
      });
    } else if ((rootdata?.vestingSchedule.length ?? 0) > 0) {
      if (!sourceUsed.includes('rootdata')) {
        sourceUsed.push('rootdata');
      }
      evidence.push({
        field: 'vestingSchedule',
        sourceName: 'rootdata',
        sourceUrl: process.env.ROOTDATA_ITEM_URL ?? 'https://docs.rootdata.com',
        extractedAt: nowIso,
      });
    }

    if (hasTokenomistInflation) {
      if (!sourceUsed.includes('tokenomist')) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'inflationRate',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistEmissionUrl(),
        extractedAt: nowIso,
      });
    } else if (
      rootdata &&
      (rootdata.inflationRate.currentAnnualPct !== null ||
        rootdata.inflationRate.targetAnnualPct !== null)
    ) {
      if (!sourceUsed.includes('rootdata')) {
        sourceUsed.push('rootdata');
      }
      evidence.push({
        field: 'inflationRate',
        sourceName: 'rootdata',
        sourceUrl: process.env.ROOTDATA_ITEM_URL ?? 'https://docs.rootdata.com',
        extractedAt: nowIso,
      });
    }

    if (tokenomistBurns.totalBurnAmount !== null) {
      if (!sourceUsed.includes('tokenomist')) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'burns',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistBurnUrl(),
        extractedAt: nowIso,
      });
    }

    if (tokenomistBuybacks.totalBuybackAmount !== null) {
      if (!sourceUsed.includes('tokenomist')) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'buybacks',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistBuybackUrl(),
        extractedAt: nowIso,
      });
    }

    if (tokenomistFundraising.totalRaised !== null) {
      if (!sourceUsed.includes('tokenomist')) {
        sourceUsed.push('tokenomist');
      }
      evidence.push({
        field: 'fundraising',
        sourceName: 'tokenomist',
        sourceUrl: this.getTokenomistFundraisingUrl(),
        extractedAt: nowIso,
      });
    }

    const tokenomicsEvidenceInsufficient =
      sourceUsed.length === 0 ||
      (allocation.teamPct === null &&
        allocation.investorPct === null &&
        allocation.foundationPct === null &&
        allocation.communityPct === null &&
        vestingSchedule.length === 0 &&
        inflationRate.currentAnnualPct === null &&
        inflationRate.targetAnnualPct === null);

    return {
      allocation,
      vestingSchedule,
      inflationRate,
      burns: tokenomistBurns,
      buybacks: tokenomistBuybacks,
      fundraising: tokenomistFundraising,
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

  private async fetchAllocation(
    identity: AnalyzeIdentity,
    meta: TokenomistTokenMeta | null,
  ): Promise<{
    found: boolean;
    value: TokenomicsSnapshot['allocation'];
  }> {
    const fallback: TokenomicsSnapshot['allocation'] = {
      teamPct: null,
      investorPct: null,
      communityPct: null,
      foundationPct: null,
    };

    if (meta?.hasStandardAllocation === false) {
      this.logger.warn(
        `Tokenomist allocation not supported for ${identity.symbol} (tokenId=${meta.tokenId ?? 'n/a'}).`,
      );
      return { found: false, value: fallback };
    }

    const body = await this.fetchTokenomist(
      this.getTokenomistAllocationsUrl(),
      identity,
      'allocation',
      meta,
    );
    if (!body || typeof body !== 'object') {
      return { found: false, value: fallback };
    }

    const obj = this.extractTokenomistNode(body);
    const allocationFromBreakdown =
      this.parseTokenomistAllocationBreakdown(obj);
    if (allocationFromBreakdown) {
      return allocationFromBreakdown;
    }

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
    meta: TokenomistTokenMeta | null,
  ): Promise<VestingItem[]> {
    const body = await this.fetchTokenomist(
      this.getTokenomistUnlocksUrl(),
      identity,
      'unlock',
      meta,
    );
    const rows = this.extractTokenomistRows(body);

    const parsed: VestingItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const normalized = this.parseTokenomistUnlockRow(row);
      for (const item of normalized) {
        const dedupeKey = `${item.bucket}:${item.start}:${item.end}:${item.unlockFrequency}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        parsed.push(item);
      }
    }
    return parsed.slice(0, 200);
  }

  private async fetchInflation(
    identity: AnalyzeIdentity,
    meta: TokenomistTokenMeta | null,
  ): Promise<TokenomicsSnapshot['inflationRate']> {
    const fallback: TokenomicsSnapshot['inflationRate'] = {
      currentAnnualPct: null,
      targetAnnualPct: null,
      isDynamic: false,
    };

    const body = await this.fetchTokenomist(
      this.getTokenomistEmissionUrl(),
      identity,
      'emission',
      meta,
    );
    if (!body || typeof body !== 'object') {
      return fallback;
    }

    const obj = this.extractTokenomistNode(body);
    const rows = this.extractTokenomistRows(body);
    let currentAnnualPct =
      this.pickPct(obj, [
        'currentAnnualPct',
        'current_annual_pct',
        'inflation_rate_current',
        'inflationRateCurrent',
      ]) ??
      this.pickPctFromRows(rows, [
        'currentAnnualPct',
        'current_annual_pct',
        'inflation_rate_current',
        'inflationRateCurrent',
      ]);
    let targetAnnualPct =
      this.pickPct(obj, [
        'targetAnnualPct',
        'target_annual_pct',
        'inflation_rate_target',
        'inflationRateTarget',
      ]) ??
      this.pickPctFromRows(rows, [
        'targetAnnualPct',
        'target_annual_pct',
        'inflation_rate_target',
        'inflationRateTarget',
      ]);
    const isDynamicRaw =
      obj.isDynamic ??
      obj.is_dynamic ??
      obj.dynamic ??
      this.pickBoolFromRows(rows, ['isDynamic', 'is_dynamic', 'dynamic']);

    if (currentAnnualPct === null && targetAnnualPct === null) {
      const supply =
        meta?.maxSupply && meta.maxSupply > 0
          ? meta.maxSupply
          : meta?.circulatingSupply && meta.circulatingSupply > 0
            ? meta.circulatingSupply
            : null;
      const derived = this.deriveAnnualInflationFromEmission(rows, supply);
      if (derived !== null) {
        currentAnnualPct = derived;
      }
    }

    return {
      currentAnnualPct,
      targetAnnualPct,
      isDynamic: this.toBool(isDynamicRaw) ?? false,
    };
  }

  private async fetchBurns(
    identity: AnalyzeIdentity,
    meta: TokenomistTokenMeta | null,
  ): Promise<{
    totalBurnAmount: number | null;
    recentBurns: Array<{
      burnEventLabel: string;
      burnType: string;
      burnDate: string;
      amount: number;
      metadata: { burners: string[]; burnReasons: string[] };
    }>;
  }> {
    const fallback = { totalBurnAmount: null, recentBurns: [] };

    const tokenId = meta?.tokenId;
    if (!tokenId) {
      return fallback;
    }

    const apiKey = this.getTokenomistApiKey();
    if (!apiKey) {
      return fallback;
    }

    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const url = `${this.getTokenomistBurnUrl()}/${tokenId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as unknown;
      const obj = this.extractTokenomistNode(payload);
      const totalBurnAmount = this.toNumber(obj.totalBurnAmount);
      const burnsArray = Array.isArray(obj.burns) ? obj.burns : [];
      const recentBurns = burnsArray
        .slice(0, 10)
        .map((burn: any) => ({
          burnEventLabel: this.toString(burn.burnEventLabel) ?? '',
          burnType: this.toString(burn.burnType) ?? '',
          burnDate: this.toDateString(burn.burnDate) ?? '',
          amount: this.toNumber(burn.amount) ?? 0,
          metadata: {
            burners: Array.isArray(burn.metadata?.burners) ? burn.metadata.burners : [],
            burnReasons: Array.isArray(burn.metadata?.burnReasons) ? burn.metadata.burnReasons : [],
          },
        }))
        .filter((burn: any) => burn.burnDate && burn.amount > 0);

      return { totalBurnAmount, recentBurns };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Tokenomist burns unavailable for ${identity.symbol}: ${message}`,
      );
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchBuybacks(
    identity: AnalyzeIdentity,
    meta: TokenomistTokenMeta | null,
  ): Promise<{
    totalBuybackAmount: number | null;
    recentBuybacks: Array<{
      buybackEventLabel: string;
      buybackType: string;
      buybackDate: string;
      tokenAmount: number;
      value: number;
      spentAmount: number;
      spentUnit: string;
    }>;
  }> {
    const fallback = { totalBuybackAmount: null, recentBuybacks: [] };

    const tokenId = meta?.tokenId;
    if (!tokenId) {
      return fallback;
    }

    const apiKey = this.getTokenomistApiKey();
    if (!apiKey) {
      return fallback;
    }

    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const url = `${this.getTokenomistBuybackUrl()}/${tokenId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as unknown;
      const obj = this.extractTokenomistNode(payload);
      const totalBuybackAmount = this.toNumber(obj.totalBuybackAmount);
      const buybacksArray = Array.isArray(obj.buybacks) ? obj.buybacks : [];
      const recentBuybacks = buybacksArray
        .slice(0, 10)
        .map((buyback: any) => ({
          buybackEventLabel: this.toString(buyback.buybackEventLabel) ?? '',
          buybackType: this.toString(buyback.buybackType) ?? '',
          buybackDate: this.toDateString(buyback.buybackDate) ?? '',
          tokenAmount: this.toNumber(buyback.tokenAmount) ?? 0,
          value: this.toNumber(buyback.value) ?? 0,
          spentAmount: this.toNumber(buyback.spentAmount) ?? 0,
          spentUnit: this.toString(buyback.spentUnit) ?? '',
        }))
        .filter((buyback: any) => buyback.buybackDate && buyback.tokenAmount > 0);

      return { totalBuybackAmount, recentBuybacks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Tokenomist buybacks unavailable for ${identity.symbol}: ${message}`,
      );
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchFundraising(
    identity: AnalyzeIdentity,
    meta: TokenomistTokenMeta | null,
  ): Promise<{
    totalRaised: number | null;
    rounds: Array<{
      roundName: string;
      fundingDate: string;
      amountRaised: number;
      currency: string;
      valuation: number | null;
      investors: string[];
    }>;
  }> {
    const fallback = { totalRaised: null, rounds: [] };

    const tokenId = meta?.tokenId;
    if (!tokenId) {
      return fallback;
    }

    const apiKey = this.getTokenomistApiKey();
    if (!apiKey) {
      return fallback;
    }

    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const url = `${this.getTokenomistFundraisingUrl()}/${tokenId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as unknown;
      const obj = this.extractTokenomistNode(payload);
      const totalRaised = this.toNumber(obj.totalRaised ?? obj.totalFundingAmount);
      const roundsArray = Array.isArray(obj.rounds) ? obj.rounds : Array.isArray(obj.fundraisingRounds) ? obj.fundraisingRounds : [];
      const rounds = roundsArray
        .slice(0, 10)
        .map((round: any) => ({
          roundName: this.toString(round.roundName ?? round.round) ?? '',
          fundingDate: this.toDateString(round.fundingDate ?? round.date) ?? '',
          amountRaised: this.toNumber(round.amountRaised ?? round.amount) ?? 0,
          currency: this.toString(round.currency ?? round.unit) ?? 'USD',
          valuation: this.toNumber(round.valuation),
          investors: Array.isArray(round.investors) ? round.investors.map((inv: any) => this.toString(inv) ?? '').filter(Boolean) : [],
        }))
        .filter((round: any) => round.fundingDate && round.amountRaised > 0);

      return { totalRaised, rounds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Tokenomist fundraising unavailable for ${identity.symbol}: ${message}`,
      );
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchRootDataTokenomics(
    identity: AnalyzeIdentity,
  ): Promise<RootDataTokenomicsResult | null> {
    const apiKey =
      process.env.ROOTDATA_ACCESS_KEY ?? process.env.ROOTDATA_API_KEY;
    if (!apiKey?.trim()) {
      return null;
    }

    const searchBody = await this.fetchRootData(
      process.env.ROOTDATA_SEARCH_URL ??
        'https://api.rootdata.com/open/ser_inv',
      {
        query: identity.symbol,
        page: 1,
        size: 10,
      },
      apiKey.trim(),
      'search',
    );

    const projectId = this.extractRootDataProjectId(searchBody);
    if (projectId === null) {
      return null;
    }

    const itemBody = await this.fetchRootData(
      process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item',
      {
        project_id: projectId,
      },
      apiKey.trim(),
      'item',
    );
    if (!itemBody || typeof itemBody !== 'object') {
      return null;
    }

    const root = this.extractRootDataNode(itemBody);
    if (!root) {
      return null;
    }

    const tokenomicsNode =
      this.pickObject(root, [
        'tokenomics',
        'token_economics',
        'tokenomics_info',
        'token_info',
        'token',
      ]) ?? root;

    const allocation: TokenomicsSnapshot['allocation'] = {
      teamPct: this.pickPct(tokenomicsNode, [
        'teamPct',
        'team',
        'team_pct',
        'allocation_team_pct',
      ]),
      investorPct: this.pickPct(tokenomicsNode, [
        'investorPct',
        'investors',
        'investor_pct',
        'allocation_investor_pct',
      ]),
      communityPct: this.pickPct(tokenomicsNode, [
        'communityPct',
        'community',
        'community_pct',
        'allocation_community_pct',
      ]),
      foundationPct: this.pickPct(tokenomicsNode, [
        'foundationPct',
        'foundation',
        'foundation_pct',
        'allocation_foundation_pct',
      ]),
    };

    const vestingSchedule = this.extractRootDataVesting(tokenomicsNode);

    const inflationRate: TokenomicsSnapshot['inflationRate'] = {
      currentAnnualPct: this.pickPct(tokenomicsNode, [
        'currentAnnualPct',
        'current_annual_pct',
        'inflation_rate_current',
      ]),
      targetAnnualPct: this.pickPct(tokenomicsNode, [
        'targetAnnualPct',
        'target_annual_pct',
        'inflation_rate_target',
      ]),
      isDynamic:
        this.pickBool(tokenomicsNode, ['isDynamic', 'is_dynamic', 'dynamic']) ??
        false,
    };

    const allocationFound = Object.values(allocation).some(
      (value) => typeof value === 'number',
    );

    return {
      allocation,
      allocationFound,
      vestingSchedule,
      inflationRate,
    };
  }

  private extractRootDataProjectId(value: unknown): number | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const obj = value as Record<string, unknown>;
    const candidates = [obj.data, obj.result, obj.list, obj.items];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      for (const row of candidate) {
        if (!row || typeof row !== 'object') {
          continue;
        }
        const id = this.toNumber((row as Record<string, unknown>).project_id);
        if (id !== null) {
          return Math.round(id);
        }
        const id2 = this.toNumber((row as Record<string, unknown>).id);
        if (id2 !== null) {
          return Math.round(id2);
        }
      }
    }

    return null;
  }

  private extractRootDataNode(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const obj = value as Record<string, unknown>;
    const direct = this.pickObject(obj, ['data', 'result', 'item', 'project']);
    if (direct) {
      return direct;
    }

    return obj;
  }

  private extractRootDataVesting(
    tokenomicsNode: Record<string, unknown>,
  ): VestingItem[] {
    const candidates = [
      tokenomicsNode.vesting,
      tokenomicsNode.unlock_schedule,
      tokenomicsNode.unlocks,
      tokenomicsNode.vesting_schedule,
      tokenomicsNode.token_unlock_schedule,
    ];

    let rows: unknown[] = [];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        rows = candidate;
        break;
      }
    }

    const parsed: VestingItem[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        continue;
      }

      const obj = row as Record<string, unknown>;
      const bucket = this.toString(obj.bucket ?? obj.name ?? obj.category);
      const start = this.toDateString(obj.start ?? obj.start_at ?? obj.begin);
      const end = this.toDateString(obj.end ?? obj.end_at ?? obj.finish);
      const cliffMonths = this.toNumber(
        obj.cliffMonths ?? obj.cliff_months ?? obj.cliff,
      );
      const unlockFrequency = this.toUnlockFrequency(
        obj.unlockFrequency ?? obj.unlock_frequency ?? obj.frequency,
      );

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

  private pickPct(
    input: Record<string, unknown>,
    keys: string[],
  ): number | null {
    const number = this.pickNumber(input, keys);
    if (number === null) {
      return null;
    }
    return Number(number.toFixed(2));
  }

  private pickNumber(
    input: Record<string, unknown>,
    keys: string[],
  ): number | null {
    for (const key of keys) {
      const direct = this.toNumber(input[key]);
      if (direct !== null) {
        return direct;
      }
    }

    for (const value of Object.values(input)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const nested = this.pickNumber(value as Record<string, unknown>, keys);
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  private pickBool(
    input: Record<string, unknown>,
    keys: string[],
  ): boolean | null {
    for (const key of keys) {
      const direct = this.toBool(input[key]);
      if (direct !== null) {
        return direct;
      }
    }

    for (const value of Object.values(input)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const nested = this.pickBool(value as Record<string, unknown>, keys);
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  private pickObject(
    input: Record<string, unknown>,
    keys: string[],
  ): Record<string, unknown> | null {
    for (const key of keys) {
      const value = input[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return null;
  }

  private getTokenomistAllocationsUrl(): string {
    return (
      process.env.TOKENOMIST_ALLOCATIONS_URL?.trim() ||
      'https://api.tokenomist.ai/v2/allocations'
    );
  }

  private getTokenomistUnlocksUrl(): string {
    return (
      process.env.TOKENOMIST_UNLOCKS_URL?.trim() ||
      'https://api.tokenomist.ai/v2/unlock/events'
    );
  }

  private getTokenomistEmissionUrl(): string {
    return (
      process.env.TOKENOMIST_EMISSION_URL?.trim() ||
      'https://api.tokenomist.ai/v2/daily-emission'
    );
  }

  private getTokenomistTokenListUrl(): string {
    return (
      process.env.TOKENOMIST_TOKEN_LIST_URL?.trim() ||
      'https://api.tokenomist.ai/v4/token/list'
    );
  }

  private getTokenomistBurnUrl(): string {
    return (
      process.env.TOKENOMIST_BURN_URL?.trim() ||
      'https://api.tokenomist.ai/v1/burn'
    );
  }

  private getTokenomistBuybackUrl(): string {
    return (
      process.env.TOKENOMIST_BUYBACK_URL?.trim() ||
      'https://api.tokenomist.ai/v1/buyback'
    );
  }

  private getTokenomistFundraisingUrl(): string {
    return (
      process.env.TOKENOMIST_FUNDRAISING_URL?.trim() ||
      'https://api.tokenomist.ai/v1/fundraising/token'
    );
  }

  private getTokenomistApiKey(): string | null {
    const apiKey =
      process.env.TOKENOMIST_ACCESS_KEY ?? process.env.TOKENOMIST_API_KEY;
    return apiKey?.trim() ? apiKey.trim() : null;
  }

  private extractTokenomistNode(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const obj = value as Record<string, unknown>;
    const data = obj.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }

    const result = obj.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }

    return obj;
  }

  private extractTokenomistRows(
    value: unknown,
  ): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> => {
        return Boolean(row && typeof row === 'object');
      });
    }
    if (!value || typeof value !== 'object') {
      return [];
    }

    const obj = value as Record<string, unknown>;
    const node = this.extractTokenomistNode(value);
    const candidates: unknown[] = [
      obj.items,
      obj.results,
      obj.rows,
      obj.list,
      obj.data,
      obj.result,
      node.items,
      node.results,
      node.rows,
      node.list,
      node.allocations,
      node.events,
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      return candidate.filter((row): row is Record<string, unknown> => {
        return Boolean(row && typeof row === 'object');
      });
    }

    return [];
  }

  private pickPctFromRows(
    rows: Array<Record<string, unknown>>,
    keys: string[],
  ): number | null {
    for (const row of rows) {
      const value = this.pickPct(row, keys);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  private pickBoolFromRows(
    rows: Array<Record<string, unknown>>,
    keys: string[],
  ): boolean | null {
    for (const row of rows) {
      const value = this.pickBool(row, keys);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  private parseTokenomistAllocationBreakdown(input: Record<string, unknown>): {
    found: boolean;
    value: TokenomicsSnapshot['allocation'];
  } | null {
    const allocationNode =
      this.pickObject(input, ['allocation', 'tokenomics']) ?? input;
    const maxSupply = this.pickNumber(allocationNode, [
      'maxSupply',
      'max_supply',
      'totalSupply',
      'total_supply',
    ]);
    const rows = this.extractTokenomistRows({
      allocations: allocationNode.allocations,
      items: allocationNode.items,
      rows: allocationNode.rows,
    });
    if (rows.length === 0) {
      return null;
    }

    const totals = {
      teamPct: 0,
      investorPct: 0,
      communityPct: 0,
      foundationPct: 0,
    };
    let hasAny = false;

    for (const row of rows) {
      const bucket = this.classifyAllocationBucket(
        this.toString(
          row.standardAllocationName ??
            row.allocationName ??
            row.bucket ??
            row.name,
        ) ?? '',
      );
      if (!bucket) {
        continue;
      }

      const pctRaw = this.toNumber(
        row.trackedAllocationPercentage ??
          row.allocationPercentage ??
          row.allocation_pct ??
          row.percentage ??
          row.percent,
      );
      const amount = this.toNumber(
        row.allocationAmount ?? row.amount ?? row.allocation_amount,
      );
      const pct =
        pctRaw !== null
          ? pctRaw
          : amount !== null && maxSupply !== null && maxSupply > 0
            ? (amount / maxSupply) * 100
            : null;
      if (pct === null) {
        continue;
      }

      totals[bucket] += pct;
      hasAny = true;
    }

    if (!hasAny) {
      return null;
    }

    return {
      found: true,
      value: {
        teamPct: Number(totals.teamPct.toFixed(2)),
        investorPct: Number(totals.investorPct.toFixed(2)),
        communityPct: Number(totals.communityPct.toFixed(2)),
        foundationPct: Number(totals.foundationPct.toFixed(2)),
      },
    };
  }

  private classifyAllocationBucket(
    raw: string,
  ): keyof TokenomicsSnapshot['allocation'] | null {
    const text = raw.trim().toLowerCase();
    if (!text) {
      return null;
    }

    if (
      text.includes('team') ||
      text.includes('founder') ||
      text.includes('advisor')
    ) {
      return 'teamPct';
    }
    if (
      text.includes('investor') ||
      text.includes('private') ||
      text.includes('seed') ||
      text.includes('strategic')
    ) {
      return 'investorPct';
    }
    if (
      text.includes('community') ||
      text.includes('airdrop') ||
      text.includes('incentive') ||
      text.includes('reward')
    ) {
      return 'communityPct';
    }
    if (
      text.includes('foundation') ||
      text.includes('treasury') ||
      text.includes('reserve') ||
      text.includes('dao') ||
      text.includes('ecosystem')
    ) {
      return 'foundationPct';
    }

    return null;
  }

  private parseTokenomistUnlockRow(
    row: Record<string, unknown>,
  ): VestingItem[] {
    const breakdownRaw = row.allocationBreakdown ?? row.allocations;
    const breakdowns = Array.isArray(breakdownRaw)
      ? breakdownRaw.filter((item): item is Record<string, unknown> => {
          return Boolean(item && typeof item === 'object');
        })
      : [row];

    const parsed: VestingItem[] = [];
    for (const item of breakdowns) {
      const bucket = this.toString(
        item.allocationName ??
          item.standardAllocationName ??
          item.bucket ??
          row.bucket ??
          row.name,
      );
      const date =
        this.toDateString(item.unlockDate ?? row.unlockDate) ??
        this.toDateString(item.startDate ?? row.startDate);
      const end =
        this.toDateString(item.endDate ?? row.endDate) ??
        this.toDateString(item.unlockDate ?? row.unlockDate) ??
        date;
      if (!bucket || !date || !end) {
        continue;
      }

      const cliffMonths =
        this.toNumber(item.cliffMonths ?? row.cliffMonths) ?? 0;
      const unlockFrequency =
        this.toUnlockFrequency(
          item.unlockPrecision ??
            row.unlockPrecision ??
            item.unlockFrequency ??
            row.unlockFrequency,
        ) ?? 'monthly';

      parsed.push({
        bucket,
        start: date,
        cliffMonths: Math.max(0, Math.round(cliffMonths)),
        unlockFrequency,
        end,
      });
    }

    return parsed;
  }

  private deriveAnnualInflationFromEmission(
    rows: Array<Record<string, unknown>>,
    supply: number | null,
  ): number | null {
    if (!rows.length || typeof supply !== 'number' || supply <= 0) {
      return null;
    }

    const parsed = rows
      .map((row) => {
        const date =
          this.toDateString(row.startDate ?? row.start_date ?? row.date) ??
          this.toDateString(row.endDate ?? row.end_date);
        let unlockAmount = this.toNumber(
          row.unlockAmount ?? row.unlock_amount ?? row.amount ?? row.unlocked_amount,
        );
        if (unlockAmount === null) {
          const unlockValue = this.toNumber(
            row.unlockValue ?? row.unlock_value ?? row.value ?? row.unlocked_value,
          );
          const referencePrice = this.toNumber(
            row.referencePrice ?? row.reference_price ?? row.price,
          );
          if (
            unlockValue !== null &&
            referencePrice !== null &&
            referencePrice > 0
          ) {
            unlockAmount = unlockValue / referencePrice;
          }
        }
        if (!date || unlockAmount === null) {
          return null;
        }
        return { date, unlockAmount };
      })
      .filter(
        (row): row is { date: string; unlockAmount: number } => row !== null,
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (parsed.length === 0) {
      return null;
    }

    const windowDays = Math.min(30, parsed.length);
    const recent = parsed.slice(-windowDays);
    const sum = recent.reduce((acc, row) => acc + row.unlockAmount, 0);
    if (!Number.isFinite(sum) || sum <= 0) {
      return null;
    }

    const annualized = (sum / supply) * (365 / windowDays) * 100;
    if (!Number.isFinite(annualized)) {
      return null;
    }
    return Number(annualized.toFixed(2));
  }

  private async resolveTokenomistTokenId(
    identity: AnalyzeIdentity,
  ): Promise<string | null> {
    const cacheKey = `${identity.chain.toLowerCase()}:${identity.tokenAddress.toLowerCase()}`;
    if (this.tokenomistTokenIdCache.has(cacheKey)) {
      return this.tokenomistTokenIdCache.get(cacheKey) ?? null;
    }

    const meta = await this.resolveTokenomistTokenMeta(identity);
    const tokenId = meta?.tokenId ?? null;
    this.tokenomistTokenIdCache.set(cacheKey, tokenId);
    return tokenId;
  }

  private async resolveTokenomistTokenMeta(
    identity: AnalyzeIdentity,
  ): Promise<TokenomistTokenMeta | null> {
    const cacheKey = `${identity.chain.toLowerCase()}:${identity.tokenAddress.toLowerCase()}`;
    if (this.tokenomistTokenMetaCache.has(cacheKey)) {
      return this.tokenomistTokenMetaCache.get(cacheKey) ?? null;
    }

    const fromEnv = this.resolveTokenomistTokenIdFromMap(identity);
    const fallbackMeta: TokenomistTokenMeta | null = fromEnv
      ? {
          tokenId: fromEnv,
          hasStandardAllocation: null,
          circulatingSupply: null,
          maxSupply: null,
          totalLockedAmount: null,
        }
      : null;

    const apiKey = this.getTokenomistApiKey();
    if (!apiKey) {
      this.tokenomistTokenMetaCache.set(cacheKey, fallbackMeta);
      return fallbackMeta;
    }

    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const query = identity.symbol.trim().toUpperCase();
    const params = new URLSearchParams({
      page: '1',
      pageSize: '50',
      search: query,
    });
    const url = `${this.getTokenomistTokenListUrl()}?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      if (!response.ok) {
        this.tokenomistTokenMetaCache.set(cacheKey, fallbackMeta);
        return fallbackMeta;
      }

      const payload = (await response.json()) as unknown;
      const rows = this.extractTokenomistRows(payload);
      let meta = this.extractTokenomistTokenMeta(rows, identity);
      if (meta && !meta.tokenId && fromEnv) {
        meta = { ...meta, tokenId: fromEnv };
      }
      if (!meta && fallbackMeta) {
        meta = fallbackMeta;
      }
      this.tokenomistTokenMetaCache.set(cacheKey, meta ?? null);
      return meta ?? null;
    } catch {
      this.tokenomistTokenMetaCache.set(cacheKey, fallbackMeta);
      return fallbackMeta;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractTokenomistTokenMeta(
    rows: Array<Record<string, unknown>>,
    identity: AnalyzeIdentity,
  ): TokenomistTokenMeta | null {
    if (!rows.length) {
      return null;
    }

    const address = identity.tokenAddress.toLowerCase();
    const symbol = identity.symbol.trim().toUpperCase();

    let selected =
      rows.find((row) => {
        const tokenAddress = this.toString(
          row.tokenAddress ?? row.token_address ?? row.address,
        )?.toLowerCase();
        return tokenAddress ? tokenAddress === address : false;
      }) ??
      rows.find((row) => {
        const rowSymbol = this.toString(row.symbol ?? row.ticker)?.toUpperCase();
        return rowSymbol ? rowSymbol === symbol : false;
      }) ??
      rows[0];

    if (!selected) {
      return null;
    }

    const tokenId = this.toString(
      selected.tokenId ?? selected.token_id ?? selected.id ?? selected.uuid,
    );
    if (!tokenId) {
      return null;
    }

    return {
      tokenId,
      hasStandardAllocation:
        this.toBool(
          selected.hasStandardAllocation ??
            selected.has_standard_allocation ??
            selected.standardAllocation,
        ) ?? null,
      circulatingSupply: this.toNumber(
        selected.circulatingSupply ?? selected.circulating_supply,
      ),
      maxSupply: this.toNumber(selected.maxSupply ?? selected.max_supply),
      totalLockedAmount: this.toNumber(
        selected.totalLockedAmount ?? selected.total_locked_amount,
      ),
    };
  }

  private resolveTokenomistTokenIdFromMap(
    identity: AnalyzeIdentity,
  ): string | null {
    const raw = process.env.TOKENOMIST_TOKEN_ID_MAP;
    if (!raw?.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const addressKey = identity.tokenAddress.toLowerCase();
      const symbolKey = identity.symbol.toUpperCase();
      const byAddress = parsed[addressKey];
      if (typeof byAddress === 'string' && byAddress.trim()) {
        return byAddress.trim();
      }
      const bySymbol = parsed[symbolKey];
      if (typeof bySymbol === 'string' && bySymbol.trim()) {
        return bySymbol.trim();
      }
    } catch {
      // ignore invalid map format
    }

    return null;
  }

  private async fetchTokenomist(
    baseUrl: string,
    identity: AnalyzeIdentity,
    label: string,
    meta?: TokenomistTokenMeta | null,
  ): Promise<unknown> {
    const apiKey = this.getTokenomistApiKey();
    if (!apiKey) {
      return null;
    }

    const timeoutMs = Number(process.env.TOKENOMIST_TIMEOUT_MS ?? 5000);
    const params = new URLSearchParams();
    const tokenId = meta?.tokenId ?? (await this.resolveTokenomistTokenId(identity));
    if (tokenId) {
      params.set('tokenId', tokenId);
      params.set('token_id', tokenId);
    }
    params.set('symbol', identity.symbol);
    params.set('token_address', identity.tokenAddress);
    params.set('tokenAddress', identity.tokenAddress);
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'x-api-key': apiKey,
      };
      headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
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

  private async fetchRootData(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    label: string,
  ): Promise<unknown> {
    const timeoutMs = Number(process.env.ROOTDATA_TIMEOUT_MS ?? 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          apikey: apiKey,
          language: process.env.ROOTDATA_LANGUAGE ?? 'en',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        this.logger.warn(
          `RootData ${label} fetch failed (${response.status}).`,
        );
        return null;
      }

      return (await response.json()) as
        | RootDataSearchResponse
        | RootDataItemResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`RootData ${label} unavailable: ${message}`);
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
      const normalized = value.trim().replace('%', '').replace(/,/g, '');
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

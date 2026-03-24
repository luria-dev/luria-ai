import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  FundamentalsFundraisingRound,
  FundamentalsInvestor,
  FundamentalsSnapshot,
  FundamentalsTeamMember,
} from '../../../data/contracts/analyze-contracts';

type RootDataSearchResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataItemResponse = {
  data?: unknown;
  result?: unknown;
  item?: unknown;
  project?: unknown;
};

type RootDataFundraisingResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataHotIndexResponse = {
  data?: unknown;
  result?: unknown;
};

type RootDataHotProjectOnXResponse = {
  data?: unknown;
  result?: unknown;
};

@Injectable()
export class FundamentalsService {
  readonly moduleName = 'fundamentals';
  private readonly logger = new Logger(FundamentalsService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<FundamentalsSnapshot> {
    const nowIso = new Date().toISOString();
    const fallback = this.buildUnavailableSnapshot('ROOTDATA_PROJECT_NOT_FOUND');

    const projectId = await this.searchProjectId(identity.symbol);
    if (!projectId) {
      return fallback;
    }

    const item = await this.fetchProjectItem(projectId);
    if (!item) {
      return this.buildUnavailableSnapshot('ROOTDATA_ITEM_NOT_FOUND', projectId);
    }

    const fundraising = await this.fetchFundraising(projectId);
    const hotIndex = await this.fetchHotIndex(projectId);
    const hotX = await this.fetchHotProjectOnX(projectId);

    const profile = {
      projectId,
      name: this.toString(item.project_name ?? item.name),
      tokenSymbol: this.toString(item.token_symbol ?? item.symbol),
      oneLiner: this.toString(item.one_liner ?? item.introduce),
      description: this.toString(item.description ?? item.introduce),
      establishmentDate: this.toString(
        item.establishment_date ?? item.establishmentDate,
      ),
      active: this.toBool(item.active),
      logoUrl: this.toString(item.logo ?? item.logo_url ?? item.logoUrl),
      rootdataUrl: this.toString(item.rootdataurl ?? item.rootdata_url),
      tags: this.toStringArray(item.tags ?? item.tag),
      totalFundingUsd: this.toNumber(
        item.total_funding_amount ?? item.totalFundingAmount ?? item.total_funding,
      ),
      rtScore: this.toNumber(item.rt_score),
      tvlScore: this.toNumber(item.tvl_score),
      similarProjects: this.toStringArray(item.similar_project ?? item.similar_projects),
    };

    const team = this.parseTeamMembers(item);
    const investors = this.parseInvestors(item);
    const ecosystems = {
      ecosystems: this.toStringArray(
        item.ecosystem ?? item.ecosystems ?? item.ecosystem_list,
      ),
      onMainNet: this.toStringArray(item.on_main_net ?? item.onMainNet),
      onTestNet: this.toStringArray(item.on_test_net ?? item.onTestNet),
      planToLaunch: this.toStringArray(
        item.plan_to_launch ?? item.planToLaunch,
      ),
    };

    const social = {
      heat: this.toNumber(item.heat),
      heatRank: this.toNumber(item.heat_rank ?? item.heatRank),
      influence: this.toNumber(item.influence),
      influenceRank: this.toNumber(item.influence_rank ?? item.influenceRank),
      followers: this.toNumber(item.followers),
      following: this.toNumber(item.following),
      hotIndexScore: hotIndex?.score ?? null,
      hotIndexRank: hotIndex?.rank ?? null,
      xHeatScore: hotX?.heatScore ?? null,
      xHeatRank: hotX?.heatRank ?? null,
      xInfluenceScore: hotX?.influenceScore ?? null,
      xInfluenceRank: hotX?.influenceRank ?? null,
      xFollowersScore: hotX?.followersScore ?? null,
      xFollowersRank: hotX?.followersRank ?? null,
      socialLinks: this.toStringArray(
        item.social_media ?? item.socialMedia ?? item.social,
      ),
    };

    const degraded = !profile.name;
    const degradeReason = degraded ? 'ROOTDATA_PROFILE_MISSING' : undefined;

    return {
      profile,
      team,
      investors,
      fundraising,
      ecosystems,
      social,
      asOf: nowIso,
      sourceUsed: ['rootdata'],
      degraded,
      degradeReason,
    };
  }

  private async searchProjectId(symbol: string): Promise<number | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }

    const searchUrl =
      process.env.ROOTDATA_SEARCH_URL ??
      'https://api.rootdata.com/open/ser_inv';
    const payload = {
      query: symbol,
      page: 1,
      size: 10,
    };
    const body = await this.fetchRootData(
      searchUrl,
      payload,
      apiKey,
      'search',
    );
    if (!body || typeof body !== 'object') {
      return null;
    }

    const rows = this.extractRows(body);
    const projectRow =
      rows.find((row) => this.toNumber(row.type) === 1) ?? rows[0];
    if (!projectRow) {
      return null;
    }
    const id =
      this.toNumber(projectRow.project_id) ?? this.toNumber(projectRow.id);
    return id !== null ? Math.round(id) : null;
  }

  private async fetchProjectItem(
    projectId: number,
  ): Promise<Record<string, unknown> | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }

    const itemUrl =
      process.env.ROOTDATA_ITEM_URL ?? 'https://api.rootdata.com/open/get_item';
    const payload = {
      project_id: projectId,
      include_team: 1,
      include_investors: 1,
    };
    const body = await this.fetchRootData(itemUrl, payload, apiKey, 'item');
    if (!body || typeof body !== 'object') {
      return null;
    }
    return this.extractItemNode(body);
  }

  private async fetchFundraising(
    projectId: number,
  ): Promise<FundamentalsFundraisingRound[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return [];
    }

    const enable = process.env.ROOTDATA_ENABLE_FUNDRAISING ?? '1';
    if (!['1', 'true', 'yes', 'on'].includes(enable.trim().toLowerCase())) {
      return [];
    }

    const url =
      process.env.ROOTDATA_FUNDRAISING_URL ??
      'https://api.rootdata.com/open/get_fac';
    const payload = {
      project_id: projectId,
      page: 1,
      size: 20,
    };
    const body = await this.fetchRootData(url, payload, apiKey, 'fundraising');
    if (!body || typeof body !== 'object') {
      return [];
    }

    const rows = this.extractRows(body);
    return rows
      .map((row) => this.toFundraisingRound(row))
      .filter(
        (row): row is FundamentalsFundraisingRound => row !== null,
      );
  }

  private async fetchHotIndex(
    projectId: number,
  ): Promise<{ score: number | null; rank: number | null } | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }

    const enable = process.env.ROOTDATA_ENABLE_HOT_INDEX ?? '0';
    if (!['1', 'true', 'yes', 'on'].includes(enable.trim().toLowerCase())) {
      return null;
    }

    const url =
      process.env.ROOTDATA_HOT_INDEX_URL ??
      'https://api.rootdata.com/open/hot_index';
    const payload = {
      days: Number(process.env.ROOTDATA_HOT_INDEX_DAYS ?? 1),
    };
    const body = await this.fetchRootData(url, payload, apiKey, 'hot_index');
    if (!body || typeof body !== 'object') {
      return null;
    }

    const rows = this.extractRows(body);
    const index = rows.findIndex(
      (row) => this.toNumber(row.project_id) === projectId,
    );
    if (index < 0) {
      return null;
    }
    const score = this.toNumber(rows[index]?.score ?? rows[index]?.heat);
    return { score, rank: index + 1 };
  }

  private async fetchHotProjectOnX(projectId: number): Promise<{
    heatScore: number | null;
    heatRank: number | null;
    influenceScore: number | null;
    influenceRank: number | null;
    followersScore: number | null;
    followersRank: number | null;
  } | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }

    const enable = process.env.ROOTDATA_ENABLE_HOT_X ?? '0';
    if (!['1', 'true', 'yes', 'on'].includes(enable.trim().toLowerCase())) {
      return null;
    }

    const url =
      process.env.ROOTDATA_HOT_PROJECT_X_URL ??
      'https://api.rootdata.com/open/hot_project_on_x';
    const payload = {
      heat: true,
      influence: true,
      followers: true,
    };
    const body = await this.fetchRootData(url, payload, apiKey, 'hot_x');
    if (!body || typeof body !== 'object') {
      return null;
    }

    const node = this.extractItemNode(body) ?? (body as Record<string, unknown>);
    const heat = this.extractRows(node.heat ?? node.heat_list);
    const influence = this.extractRows(node.influence ?? node.influence_list);
    const followers = this.extractRows(node.followers ?? node.followers_list);

    const heatIndex = heat.findIndex(
      (row) => this.toNumber(row.project_id) === projectId,
    );
    const influenceIndex = influence.findIndex(
      (row) => this.toNumber(row.project_id) === projectId,
    );
    const followersIndex = followers.findIndex(
      (row) => this.toNumber(row.project_id) === projectId,
    );

    return {
      heatScore: heatIndex >= 0 ? this.toNumber(heat[heatIndex]?.score) : null,
      heatRank: heatIndex >= 0 ? heatIndex + 1 : null,
      influenceScore:
        influenceIndex >= 0
          ? this.toNumber(influence[influenceIndex]?.score)
          : null,
      influenceRank: influenceIndex >= 0 ? influenceIndex + 1 : null,
      followersScore:
        followersIndex >= 0
          ? this.toNumber(followers[followersIndex]?.score)
          : null,
      followersRank: followersIndex >= 0 ? followersIndex + 1 : null,
    };
  }

  private parseTeamMembers(
    item: Record<string, unknown>,
  ): FundamentalsTeamMember[] {
    const rows = this.toArray(item.team_members ?? item.teamMembers ?? item.team);
    return rows
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const obj = row as Record<string, unknown>;
        const name = this.toString(obj.name ?? obj.full_name);
        if (!name) {
          return null;
        }
        return {
          name,
          position: this.toString(obj.title ?? obj.position ?? obj.role),
        };
      })
      .filter((row): row is FundamentalsTeamMember => row !== null);
  }

  private parseInvestors(
    item: Record<string, unknown>,
  ): FundamentalsInvestor[] {
    const rows = this.toArray(item.investors ?? item.investor_list);
    return rows
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const obj = row as Record<string, unknown>;
        const name = this.toString(obj.name ?? obj.investor_name);
        if (!name) {
          return null;
        }
        return {
          name,
          type: this.toString(obj.type ?? obj.investor_type),
          logoUrl: this.toString(obj.logo ?? obj.logo_url),
        };
      })
      .filter((row): row is FundamentalsInvestor => row !== null);
  }

  private toFundraisingRound(
    row: Record<string, unknown>,
  ): FundamentalsFundraisingRound | null {
    const round = this.toString(row.round ?? row.stage ?? row.round_name);
    const amountUsd = this.toNumber(
      row.amount ??
        row.amount_usd ??
        row.funding_amount ??
        row.funding_amount_usd,
    );
    const valuationUsd = this.toNumber(
      row.valuation ??
        row.valuation_usd ??
        row.post_money_valuation ??
        row.post_money_valuation_usd,
    );
    const publishedAt = this.toString(
      row.published_time ?? row.published_at ?? row.date,
    );
    const investors = this.toStringArray(
      row.investors ?? row.investor_list ?? row.investor,
    );

    if (!round && amountUsd === null && valuationUsd === null && !publishedAt) {
      return null;
    }

    return {
      round: round ?? null,
      amountUsd,
      valuationUsd,
      publishedAt: publishedAt ?? null,
      investors,
    };
  }

  private buildUnavailableSnapshot(
    reason: string,
    projectId: number | null = null,
  ): FundamentalsSnapshot {
    return {
      profile: {
        projectId,
        name: null,
        tokenSymbol: null,
        oneLiner: null,
        description: null,
        establishmentDate: null,
        active: null,
        logoUrl: null,
        rootdataUrl: null,
        tags: [],
        totalFundingUsd: null,
        rtScore: null,
        tvlScore: null,
        similarProjects: [],
      },
      team: [],
      investors: [],
      fundraising: [],
      ecosystems: {
        ecosystems: [],
        onMainNet: [],
        onTestNet: [],
        planToLaunch: [],
      },
      social: {
        heat: null,
        heatRank: null,
        influence: null,
        influenceRank: null,
        followers: null,
        following: null,
        hotIndexScore: null,
        hotIndexRank: null,
        xHeatScore: null,
        xHeatRank: null,
        xInfluenceScore: null,
        xInfluenceRank: null,
        xFollowersScore: null,
        xFollowersRank: null,
        socialLinks: [],
      },
      asOf: new Date().toISOString(),
      sourceUsed: ['rootdata'],
      degraded: true,
      degradeReason: reason,
    };
  }

  private getApiKey(): string | null {
    const apiKey =
      process.env.ROOTDATA_ACCESS_KEY ?? process.env.ROOTDATA_API_KEY;
    return apiKey?.trim() ? apiKey.trim() : null;
  }

  private async fetchRootData(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    label: string,
  ): Promise<unknown> {
    const timeoutMs = this.getTimeoutMs();
    const attempts = Math.max(
      1,
      Number(process.env.ROOTDATA_RETRY_ATTEMPTS ?? 3),
    );

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
          this.logger.warn(`RootData ${label} fetch failed (${response.status}).`);
          return null;
        }

        return (await response.json()) as
          | RootDataSearchResponse
          | RootDataItemResponse
          | RootDataFundraisingResponse
          | RootDataHotIndexResponse
          | RootDataHotProjectOnXResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          attempt < attempts &&
          (message.includes('aborted') || message.includes('fetch failed'));
        this.logger.warn(
          `RootData ${label} unavailable${retryable ? ` (attempt ${attempt}/${attempts})` : ''}: ${message}`,
        );
        if (!retryable) {
          return null;
        }
        await this.delay(300 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  }

  private getTimeoutMs(): number {
    const configured = Number(process.env.ROOTDATA_TIMEOUT_MS ?? 8000);
    return Number.isFinite(configured) ? Math.max(configured, 12000) : 12000;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractRows(value: unknown): Array<Record<string, unknown>> {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const obj = value as Record<string, unknown>;
    const candidates = [obj.data, obj.result, obj.list, obj.items];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row && typeof row === 'object'),
        );
      }
      if (candidate && typeof candidate === 'object') {
        const rows = (candidate as Record<string, unknown>).rows;
        if (Array.isArray(rows)) {
          return rows.filter(
            (row): row is Record<string, unknown> =>
              Boolean(row && typeof row === 'object'),
          );
        }
      }
    }
    return [];
  }

  private extractItemNode(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const obj = value as Record<string, unknown>;
    const direct =
      (obj.data as Record<string, unknown>) ??
      (obj.result as Record<string, unknown>) ??
      (obj.item as Record<string, unknown>) ??
      (obj.project as Record<string, unknown>);
    if (direct && typeof direct === 'object') {
      return direct;
    }
    return obj;
  }

  private toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        return obj.items;
      }
      if (Array.isArray(obj.rows)) {
        return obj.rows;
      }
    }
    return [];
  }

  private toStringArray(value: unknown): string[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.toString(item))
        .filter((item): item is string => Boolean(item));
    }
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>)
        .map((item) => this.toString(item))
        .filter((item): item is string => Boolean(item));
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private toString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace(/,/g, '');
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
      if (normalized === '') {
        return null;
      }
    }
    return null;
  }
}

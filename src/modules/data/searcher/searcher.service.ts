import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeCandidate,
  AnalyzeIdentity,
} from '../../../data/contracts/analyze-contracts';
import { MarketService } from '../market/market.service';
import { TOKEN_REGISTRY } from '../market/native-tokens';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';
import { SearchCacheService } from '../cache/search-cache.service';

type SearcherResult =
  | { kind: 'resolved'; identity: AnalyzeIdentity }
  | { kind: 'ambiguous'; candidates: AnalyzeCandidate[] }
  | { kind: 'not_found' };

export type SearchTargetResult = {
  targetKey: string;
  targetQuery: string;
  result: SearcherResult;
};

type SearchTarget = {
  targetKey: string;
  targetQuery: string;
  canonicalEntity: string | null;
};

@Injectable()
export class SearcherService {
  readonly moduleName = 'searcher';
  private readonly logger = new Logger(SearcherService.name);
  private readonly candidateRegistry = new Map<string, AnalyzeIdentity>();
  private readonly cacheMetrics = {
    requests: 0,
    identityDbHits: 0,
    snapshotHits: 0,
    sourceFetches: 0,
  };

  constructor(
    private readonly market: MarketService,
    private readonly searchCache: SearchCacheService,
  ) {}

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  getCacheMetrics() {
    const hits =
      this.cacheMetrics.identityDbHits + this.cacheMetrics.snapshotHits;
    const hitRate =
      this.cacheMetrics.requests > 0
        ? Number(((hits / this.cacheMetrics.requests) * 100).toFixed(1))
        : 0;

    return {
      requests: this.cacheMetrics.requests,
      identityDbHits: this.cacheMetrics.identityDbHits,
      snapshotHits: this.cacheMetrics.snapshotHits,
      sourceFetches: this.cacheMetrics.sourceFetches,
      hits,
      hitRatePct: hitRate,
    };
  }

  async resolve(
    query: string,
    preferredChain?: string | null,
    intent?: Pick<IntentOutput, 'objective' | 'taskType'>,
  ): Promise<SearcherResult> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return { kind: 'not_found' };
    }

    const exactRegistryCandidates = this.searchRegistryExactCandidates(
      query,
      preferredChain,
    );
    if (exactRegistryCandidates.length > 0) {
      this.registerCandidates(exactRegistryCandidates);
      return this.toResultFromCandidates(exactRegistryCandidates);
    }

    const cachedIdentity = await this.searchCache.findIdentity(
      query,
      preferredChain,
    );
    if (cachedIdentity) {
      this.recordCacheMetric('identity_db_hit', query, preferredChain);
      return {
        kind: 'resolved',
        identity: cachedIdentity,
      };
    }

    const registryCandidates = this.searchRegistryCandidates(
      query,
      preferredChain,
    );
    if (registryCandidates.length > 0) {
      this.registerCandidates(registryCandidates);
      return this.toResultFromCandidates(registryCandidates);
    }

    const cachedCandidates = await this.searchCache.getCandidates({
      query,
      preferredChain,
      objective: intent?.objective,
      taskType: intent?.taskType,
    });
    if (cachedCandidates) {
      this.registerCandidates(cachedCandidates);
      this.recordCacheMetric('search_snapshot_hit', query, preferredChain, {
        candidateCount: cachedCandidates.length,
      });
      return this.toResultFromCandidates(cachedCandidates);
    }

    const matched = await this.market.searchCandidates(query, preferredChain);
    this.registerCandidates(matched);
    await this.searchCache.storeCandidates({
      query,
      preferredChain,
      candidates: matched,
      objective: intent?.objective ?? 'market_overview',
      taskType: intent?.taskType ?? 'single_asset',
    });
    this.recordCacheMetric('source_fetch', query, preferredChain, {
      candidateCount: matched.length,
    });

    return this.toResultFromCandidates(matched);
  }

  async resolveMany(
    query: string,
    preferredChain?: string | null,
    intent?: Pick<
      IntentOutput,
      'objective' | 'taskType' | 'entities' | 'entityMentions' | 'chains'
    >,
  ): Promise<SearchTargetResult[]> {
    const targets = this.buildTargetsFromIntent(query, intent);
    const targetChainHints = this.buildTargetChainHints(
      targets,
      preferredChain,
      intent,
    );
    const tasks = targets.map(async (target) => {
      const result = await this.resolve(
        target.targetQuery,
        targetChainHints.get(target.targetKey) ?? null,
        {
          objective: intent?.objective ?? 'market_overview',
          taskType: intent?.taskType ?? 'single_asset',
        },
      );
      if (result.kind === 'ambiguous') {
        const candidates = result.candidates.map((candidate) => ({
          ...candidate,
          targetKey: target.targetKey,
        }));
        return {
          targetKey: target.targetKey,
          targetQuery: target.targetQuery,
          result: {
            kind: 'ambiguous' as const,
            candidates,
          },
        };
      }

      return {
        targetKey: target.targetKey,
        targetQuery: target.targetQuery,
        result,
      };
    });
    return Promise.all(tasks);
  }

  private buildTargetChainHints(
    targets: SearchTarget[],
    preferredChain?: string | null,
    intent?: Pick<IntentOutput, 'entities' | 'chains'>,
  ): Map<string, string | null> {
    const normalizedPreferredChain = preferredChain?.trim().toLowerCase() || null;
    if (normalizedPreferredChain) {
      return new Map(
        targets.map((target) => [target.targetKey, normalizedPreferredChain]),
      );
    }

    const normalizedChains = (intent?.chains ?? [])
      .map((chain) => chain.trim().toLowerCase())
      .filter((chain) => chain.length > 0);
    if (normalizedChains.length === 0) {
      return new Map(targets.map((target) => [target.targetKey, null]));
    }

    if (normalizedChains.length === 1) {
      return new Map(
        targets.map((target) => [target.targetKey, normalizedChains[0]]),
      );
    }

    const normalizedEntities = (intent?.entities ?? []).map((entity) =>
      entity.trim().toUpperCase(),
    );
    const entityChainPairs = normalizedEntities.map((entity, index) => ({
      entity,
      chain: normalizedChains[index] ?? null,
    }));

    const targetChainHints = new Map<string, string | null>();
    for (const target of targets) {
      const match = entityChainPairs.find(
        (item) =>
          item.entity ===
          (target.canonicalEntity ?? target.targetQuery.trim().toUpperCase()),
      );
      targetChainHints.set(target.targetKey, match?.chain ?? null);
    }

    return targetChainHints;
  }

  resolveCandidateById(candidateId: string): AnalyzeIdentity | null {
    return this.candidateRegistry.get(candidateId) ?? null;
  }

  private searchRegistryExactCandidates(
    query: string,
    preferredChain?: string | null,
  ): AnalyzeCandidate[] {
    const normalized = this.normalizeRegistryTerm(query);
    if (!normalized) {
      return [];
    }

    const matches: AnalyzeCandidate[] = [];
    for (const [symbol, meta] of Object.entries(TOKEN_REGISTRY)) {
      const aliases = new Set([
        symbol,
        meta.displayName ?? '',
        ...(meta.aliases ?? []),
      ]);

      const exactMatch = [...aliases].some(
        (alias) => this.normalizeRegistryTerm(alias) === normalized,
      );
      if (!exactMatch) {
        continue;
      }

      if (
        preferredChain?.trim() &&
        meta.chain.toLowerCase() !== preferredChain.trim().toLowerCase()
      ) {
        continue;
      }

      matches.push({
        candidateId: this.buildRegistryCandidateId(symbol, meta),
        symbol,
        chain: meta.chain,
        tokenName: meta.displayName ?? symbol,
        tokenAddress: meta.hasContract ? (meta.tokenAddress ?? '') : '',
        quoteToken: 'OTHER',
        sourceId: `coingecko:${meta.coinId}`,
      });
    }

    return matches;
  }

  private searchRegistryCandidates(
    query: string,
    preferredChain?: string | null,
  ): AnalyzeCandidate[] {
    const normalizedQuery = this.normalizeRegistryTerm(query);
    if (normalizedQuery.length < 3) {
      return [];
    }

    const matches: Array<AnalyzeCandidate & { matchScore: number }> = [];
    for (const [symbol, meta] of Object.entries(TOKEN_REGISTRY)) {
      const chain = meta.chain.toLowerCase();
      if (
        preferredChain?.trim() &&
        chain !== preferredChain.trim().toLowerCase()
      ) {
        continue;
      }

      const aliases = new Set([
        symbol,
        meta.displayName ?? '',
        ...(meta.aliases ?? []),
      ]);

      let bestScore = 0;
      for (const alias of aliases) {
        const normalizedAlias = this.normalizeRegistryTerm(alias);
        if (normalizedAlias.length === 0) {
          continue;
        }

        const score = this.registryAliasMatchScore(
          normalizedQuery,
          normalizedAlias,
        );
        if (score > bestScore) {
          bestScore = score;
        }
      }

      if (bestScore === 0) {
        continue;
      }

      matches.push({
        candidateId: this.buildRegistryCandidateId(symbol, meta),
        tokenName: meta.displayName ?? symbol,
        symbol,
        chain,
        tokenAddress: meta.hasContract ? (meta.tokenAddress ?? '') : '',
        quoteToken: 'OTHER',
        sourceId: `coingecko:${meta.coinId}`,
        matchScore: bestScore,
      });
    }

    return matches
      .sort((left, right) => {
        if (right.matchScore !== left.matchScore) {
          return right.matchScore - left.matchScore;
        }
        return left.symbol.localeCompare(right.symbol);
      })
      .slice(0, 8)
      .map(({ matchScore: _matchScore, ...candidate }) => candidate);
  }

  private normalizeRegistryTerm(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private buildRegistryCandidateId(
    symbol: string,
    meta: { chain: string; coinId: string; hasContract: boolean; tokenAddress?: string },
  ): string {
    const registryKey = meta.hasContract
      ? (meta.tokenAddress?.toLowerCase() || meta.coinId)
      : meta.coinId;
    return `cand-${meta.chain}-${symbol.toLowerCase()}-${registryKey}`;
  }

  private registryAliasMatchScore(
    query: string,
    alias: string,
  ): number {
    if (query === alias) {
      return 100;
    }
    if (alias.startsWith(query)) {
      return 90;
    }
    if (query.startsWith(alias)) {
      return 75;
    }
    if (alias.includes(query)) {
      return 60;
    }
    return 0;
  }

  private buildTargetsFromIntent(
    query: string,
    intent?: Pick<IntentOutput, 'taskType' | 'entities' | 'entityMentions'>,
  ): SearchTarget[] {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const entities = (intent?.entities ?? [])
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
    const entityMentions = (intent?.entityMentions ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const uniqueEntities = [...new Set(entities)];

    // When multiple entities are extracted, treat them as independent targets.
    // Whether orchestrator compares them is still controlled by intent.taskType.
    if (uniqueEntities.length >= 2) {
      return uniqueEntities.slice(0, 5).map((entity, index) => ({
        targetKey: entity,
        targetQuery: entityMentions[index] ?? entity,
        canonicalEntity: entity,
      }));
    }

    // Single asset mode: use intent entity if available, fallback to raw query
    if (uniqueEntities.length > 0) {
      return [
        {
          targetKey: 'PRIMARY',
          targetQuery: entityMentions[0] ?? uniqueEntities[0],
          canonicalEntity: uniqueEntities[0],
        },
      ];
    }

    // Fallback: no entities extracted, use raw query
    return [
      {
        targetKey: 'PRIMARY',
        targetQuery: normalized,
        canonicalEntity: null,
      },
    ];
  }

  private registerCandidates(candidates: AnalyzeCandidate[]): void {
    for (const candidate of candidates) {
      this.candidateRegistry.set(candidate.candidateId, {
        symbol: candidate.symbol,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        sourceId: candidate.sourceId,
      });
    }
  }

  private toResultFromCandidates(
    candidates: AnalyzeCandidate[],
  ): SearcherResult {
    if (candidates.length === 0) {
      return { kind: 'not_found' };
    }

    if (candidates.length === 1) {
      const selected = candidates[0];
      return {
        kind: 'resolved',
        identity: {
          symbol: selected.symbol,
          chain: selected.chain,
          tokenAddress: selected.tokenAddress,
          sourceId: selected.sourceId,
        },
      };
    }

    return { kind: 'ambiguous', candidates };
  }

  private recordCacheMetric(
    mode: 'identity_db_hit' | 'search_snapshot_hit' | 'source_fetch',
    query: string,
    preferredChain?: string | null,
    detail?: { candidateCount?: number },
  ): void {
    this.cacheMetrics.requests += 1;

    if (mode === 'identity_db_hit') {
      this.cacheMetrics.identityDbHits += 1;
    } else if (mode === 'search_snapshot_hit') {
      this.cacheMetrics.snapshotHits += 1;
    } else {
      this.cacheMetrics.sourceFetches += 1;
    }

    const hits =
      this.cacheMetrics.identityDbHits + this.cacheMetrics.snapshotHits;
    const hitRate =
      this.cacheMetrics.requests > 0
        ? ((hits / this.cacheMetrics.requests) * 100).toFixed(1)
        : '0.0';

    this.logger.log(
      [
        `identity_search mode=${mode}`,
        `query="${query.trim()}"`,
        `chain=${preferredChain?.trim() || 'all'}`,
        `candidateCount=${detail?.candidateCount ?? 0}`,
        `requests=${this.cacheMetrics.requests}`,
        `hits=${hits}`,
        `hitRate=${hitRate}%`,
        `sourceFetches=${this.cacheMetrics.sourceFetches}`,
      ].join(' '),
    );
  }
}

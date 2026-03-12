import { Injectable } from '@nestjs/common';
import { AnalyzeCandidate, AnalyzeIdentity } from '../../core/contracts/analyze-contracts';
import { MarketService } from '../market/market.service';
import type { IntentOutput } from '../../core/contracts/workflow-contracts';

type SearcherResult =
  | { kind: 'resolved'; identity: AnalyzeIdentity }
  | { kind: 'ambiguous'; candidates: AnalyzeCandidate[] }
  | { kind: 'not_found' };

export type SearchTargetResult = {
  targetKey: string;
  targetQuery: string;
  result: SearcherResult;
};

@Injectable()
export class SearcherService {
  readonly moduleName = 'searcher';
  private readonly candidateRegistry = new Map<string, AnalyzeIdentity>();

  constructor(private readonly market: MarketService) {}

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async resolve(query: string, preferredChain?: string | null): Promise<SearcherResult> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return { kind: 'not_found' };
    }

    const matched = await this.market.searchCandidates(query, preferredChain);
    this.registerCandidates(matched);

    if (matched.length === 0) {
      return { kind: 'not_found' };
    }

    if (matched.length === 1) {
      const selected = matched[0];
      return {
        kind: 'resolved',
        identity: {
          symbol: selected.symbol,
          chain: selected.chain,
          tokenAddress: selected.tokenAddress,
          pairAddress: selected.pairAddress,
          quoteToken: selected.quoteToken,
          sourceId: selected.sourceId,
        },
      };
    }

    return { kind: 'ambiguous', candidates: matched };
  }

  async resolveMany(
    query: string,
    preferredChain?: string | null,
    intent?: Pick<IntentOutput, 'taskType' | 'entities'>,
  ): Promise<SearchTargetResult[]> {
    const targets = this.buildTargetsFromIntent(query, intent);
    const tasks = targets.map(async (target) => {
      const result = await this.resolve(target.targetQuery, preferredChain);
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

  resolveCandidateById(candidateId: string): AnalyzeIdentity | null {
    return this.candidateRegistry.get(candidateId) ?? null;
  }

  private buildTargetsFromIntent(
    query: string,
    intent?: Pick<IntentOutput, 'taskType' | 'entities'>,
  ): Array<{ targetKey: string; targetQuery: string }> {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    if (intent?.taskType === 'comparison') {
      const entities = (intent.entities ?? [])
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item.length > 0);
      const uniqueEntities = [...new Set(entities)];
      if (uniqueEntities.length >= 2) {
        return uniqueEntities.slice(0, 5).map((entity) => ({
          targetKey: entity,
          targetQuery: entity,
        }));
      }
    }

    return [
      {
        targetKey: 'PRIMARY',
        targetQuery: normalized,
      },
    ];
  }

  private registerCandidates(candidates: AnalyzeCandidate[]): void {
    for (const candidate of candidates) {
      this.candidateRegistry.set(candidate.candidateId, {
        symbol: candidate.symbol,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        pairAddress: candidate.pairAddress,
        quoteToken: candidate.quoteToken,
        sourceId: candidate.sourceId,
      });
    }
  }
}

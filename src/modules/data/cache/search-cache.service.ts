import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import type {
  AnalyzeCandidate,
  AnalyzeIdentity,
} from '../../../data/contracts/analyze-contracts';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';
import { PrismaService } from '../../../core/persistence/prisma.service';
import { CachePolicyService } from './cache-policy.service';

@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);
  private dbUnavailable = false;

  constructor(
    @Optional() private readonly prisma: PrismaService | null,
    private readonly cachePolicy: CachePolicyService,
  ) {}

  async findIdentity(
    query: string,
    preferredChain?: string | null,
  ): Promise<AnalyzeIdentity | null> {
    if (!this.isDbReady()) {
      return null;
    }

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return null;
    }

    try {
      const matches = await this.prisma!.asset.findMany({
        where: {
          ...(preferredChain?.trim()
            ? {
                chain: preferredChain.trim().toLowerCase(),
              }
            : {}),
          OR: [
            {
              sourceId: normalizedQuery,
            },
            {
              symbol: {
                equals: normalizedQuery.toUpperCase(),
                mode: 'insensitive',
              },
            },
            {
              displayName: {
                equals: normalizedQuery,
                mode: 'insensitive',
              },
            },
          ],
          status: 'active',
        },
        select: {
          symbol: true,
          chain: true,
          tokenAddress: true,
          sourceId: true,
        },
        take: 2,
      });

      if (matches.length !== 1) {
        return null;
      }

      return {
        symbol: matches[0].symbol,
        chain: matches[0].chain,
        tokenAddress: matches[0].tokenAddress ?? '',
        sourceId: matches[0].sourceId,
      };
    } catch (error) {
      this.disableDb('identity lookup', error);
      return null;
    }
  }

  async getCandidates(input: {
    query: string;
    preferredChain?: string | null;
    objective?: IntentOutput['objective'];
    taskType?: IntentOutput['taskType'];
  }): Promise<AnalyzeCandidate[] | null> {
    if (!this.isDbReady()) {
      return null;
    }

    const cacheKey = this.buildCacheKey(input.query, input.preferredChain);
    const nowMs = Date.now();

    try {
      const snapshot = await this.prisma!.searchSnapshot.findUnique({
        where: { cacheKey },
        select: {
          id: true,
          payload: true,
          expiresAt: true,
        },
      });

      if (!snapshot) {
        return null;
      }

      const policy = await this.cachePolicy.resolve(
        'identity_search',
        input.objective ?? 'market_overview',
        input.taskType ?? 'single_asset',
      );
      const expiresAtMs = snapshot.expiresAt.getTime();

      if (
        expiresAtMs > nowMs ||
        expiresAtMs + policy.maxStaleSeconds * 1000 > nowMs
      ) {
        this.touchSearchSnapshot(snapshot.id);
        return this.parseCandidates(snapshot.payload);
      }

      return null;
    } catch (error) {
      this.disableDb('search snapshot lookup', error);
      return null;
    }
  }

  async storeCandidates(input: {
    query: string;
    preferredChain?: string | null;
    candidates: AnalyzeCandidate[];
    objective: IntentOutput['objective'];
    taskType: IntentOutput['taskType'];
  }): Promise<void> {
    if (!this.isDbReady()) {
      return;
    }

    try {
      const policy = await this.cachePolicy.resolve(
        'identity_search',
        input.objective,
        input.taskType,
      );

      const fetchedAt = new Date();
      const expiresAt = new Date(
        fetchedAt.getTime() + policy.ttlSeconds * 1000,
      );

      await this.prisma!.searchSnapshot.upsert({
        where: {
          cacheKey: this.buildCacheKey(input.query, input.preferredChain),
        },
        update: {
          query: input.query.trim(),
          normalizedQuery: this.normalizeQuery(input.query),
          preferredChain: this.normalizeChain(input.preferredChain),
          payload: this.toInputJsonValue(input.candidates),
          resultCount: input.candidates.length,
          fetchedAt,
          expiresAt,
        },
        create: {
          query: input.query.trim(),
          normalizedQuery: this.normalizeQuery(input.query),
          preferredChain: this.normalizeChain(input.preferredChain),
          cacheKey: this.buildCacheKey(input.query, input.preferredChain),
          payload: this.toInputJsonValue(input.candidates),
          resultCount: input.candidates.length,
          fetchedAt,
          expiresAt,
        },
      });

      await this.upsertAssets(input.candidates);
    } catch (error) {
      this.disableDb('search snapshot store', error);
    }
  }

  private async upsertAssets(candidates: AnalyzeCandidate[]): Promise<void> {
    if (candidates.length === 0 || !this.isDbReady()) {
      return;
    }

    await Promise.all(
      candidates.map((candidate) =>
        this.prisma!.asset.upsert({
          where: { sourceId: candidate.sourceId },
          update: {
            symbol: candidate.symbol,
            chain: candidate.chain,
            tokenAddress: this.normalizeAddress(candidate.tokenAddress),
            displayName: candidate.tokenName,
            isNative: !candidate.tokenAddress.trim(),
            metadata: this.toInputJsonValue({
              candidateId: candidate.candidateId,
              quoteToken: candidate.quoteToken,
            }),
          },
          create: {
            symbol: candidate.symbol,
            chain: candidate.chain,
            tokenAddress: this.normalizeAddress(candidate.tokenAddress),
            sourceId: candidate.sourceId,
            displayName: candidate.tokenName,
            isNative: !candidate.tokenAddress.trim(),
            metadata: this.toInputJsonValue({
              candidateId: candidate.candidateId,
              quoteToken: candidate.quoteToken,
            }),
          },
        }),
      ),
    );
  }

  private parseCandidates(payload: Prisma.JsonValue): AnalyzeCandidate[] {
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const candidate = item as Record<string, unknown>;
      const candidateId =
        typeof candidate.candidateId === 'string' ? candidate.candidateId : '';
      const tokenName =
        typeof candidate.tokenName === 'string' ? candidate.tokenName : '';
      const symbol =
        typeof candidate.symbol === 'string' ? candidate.symbol : '';
      const chain = typeof candidate.chain === 'string' ? candidate.chain : '';
      const tokenAddress =
        typeof candidate.tokenAddress === 'string'
          ? candidate.tokenAddress
          : '';
      const sourceId =
        typeof candidate.sourceId === 'string' ? candidate.sourceId : '';

      if (!candidateId || !tokenName || !symbol || !chain || !sourceId) {
        return [];
      }

      return [
        {
          candidateId,
          tokenName,
          symbol,
          chain,
          tokenAddress,
          quoteToken:
            candidate.quoteToken === 'USDT' ||
            candidate.quoteToken === 'USDC'
              ? candidate.quoteToken
              : 'OTHER',
          sourceId,
        } satisfies AnalyzeCandidate,
      ];
    });
  }

  private touchSearchSnapshot(id: string): void {
    if (!this.isDbReady()) {
      return;
    }

    void this.prisma!.searchSnapshot
      .update({
        where: { id },
        data: {
          lastAccessedAt: new Date(),
          hitCount: { increment: 1 },
        },
      })
      .catch((error: unknown) => {
        this.disableDb('search snapshot touch', error);
      });
  }

  private buildCacheKey(query: string, preferredChain?: string | null): string {
    return [
      'identity_search',
      this.normalizeQuery(query),
      this.normalizeChain(preferredChain) ?? 'all',
    ].join(':');
  }

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  private normalizeChain(chain?: string | null): string | null {
    const normalized = chain?.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  private normalizeAddress(address?: string | null): string | null {
    const normalized = address?.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  private toInputJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private isDbReady(): boolean {
    return Boolean(this.prisma?.isConfigured()) && !this.dbUnavailable;
  }

  private disableDb(operation: string, error: unknown): void {
    if (this.dbUnavailable) {
      return;
    }

    this.dbUnavailable = true;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Search cache disabled after ${operation}: ${message}`);
  }
}

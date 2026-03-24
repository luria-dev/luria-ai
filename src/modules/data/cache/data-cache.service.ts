import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/persistence/prisma.service';
import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import { CachePolicyService } from './cache-policy.service';
import type { CachePolicyResolved, ReadThroughCacheInput } from './cache.types';

@Injectable()
export class DataCacheService {
  private readonly logger = new Logger(DataCacheService.name);
  private dbUnavailable = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cachePolicy: CachePolicyService,
  ) {}

  async readThrough<T>(input: ReadThroughCacheInput<T>): Promise<T> {
    const policy = await this.cachePolicy.resolve(
      input.dataType,
      input.objective,
      input.taskType,
    );

    if (!policy.enabled || !this.isDbReady()) {
      return input.fetcher();
    }

    const cacheKey = this.buildCacheKey({
      dataType: input.dataType,
      identity: input.identity,
      source: input.source,
      timeWindow: input.timeWindow,
    });

    const snapshot = await this.findSnapshot(cacheKey);
    const now = Date.now();

    if (snapshot && this.isFresh(snapshot.expiresAt, now)) {
      this.touchSnapshot(snapshot.id);
      return snapshot.payload as T;
    }

    if (snapshot && this.isWithinSwr(snapshot.expiresAt, policy, now)) {
      this.touchSnapshot(snapshot.id);
      return snapshot.payload as T;
    }

    try {
      const freshValue = await input.fetcher();
      await this.storeSnapshot({
        cacheKey,
        dataType: input.dataType,
        identity: input.identity,
        payload: freshValue,
        source: input.source,
        timeWindow: input.timeWindow,
        policy,
      });
      return freshValue;
    } catch (error) {
      if (snapshot && this.isWithinMaxStale(snapshot.expiresAt, policy, now)) {
        this.touchSnapshot(snapshot.id);
        return snapshot.payload as T;
      }
      throw error;
    }
  }

  private async findSnapshot(cacheKey: string): Promise<{
    id: string;
    payload: Prisma.JsonValue;
    expiresAt: Date;
  } | null> {
    if (!this.isDbReady()) {
      return null;
    }

    try {
      const snapshot = await this.prisma.dataSnapshot.findUnique({
        where: { cacheKey },
        select: {
          id: true,
          payload: true,
          expiresAt: true,
        },
      });

      return snapshot;
    } catch (error) {
      this.disableDb('snapshot lookup', error);
      return null;
    }
  }

  private async storeSnapshot(input: {
    cacheKey: string;
    dataType: ReadThroughCacheInput<unknown>['dataType'];
    identity: AnalyzeIdentity;
    payload: unknown;
    source: string;
    timeWindow?: '24h' | '7d';
    policy: CachePolicyResolved;
  }): Promise<void> {
    if (!this.isDbReady()) {
      return;
    }

    try {
      const asset = await this.prisma.asset.upsert({
        where: { sourceId: input.identity.sourceId },
        update: {
          symbol: input.identity.symbol,
          chain: input.identity.chain,
          tokenAddress: this.normalizeTokenAddress(input.identity.tokenAddress),
          metadata: this.buildAssetMetadata(input.identity),
        },
        create: {
          symbol: input.identity.symbol,
          chain: input.identity.chain,
          tokenAddress: this.normalizeTokenAddress(input.identity.tokenAddress),
          sourceId: input.identity.sourceId,
          isNative: !input.identity.tokenAddress?.trim(),
          metadata: this.buildAssetMetadata(input.identity),
        },
        select: { id: true },
      });

      const fetchedAt = new Date();
      const expiresAt = new Date(
        fetchedAt.getTime() + input.policy.ttlSeconds * 1000,
      );

      await this.prisma.dataSnapshot.upsert({
        where: { cacheKey: input.cacheKey },
        update: {
          assetId: asset.id,
          payload: this.toInputJsonValue(input.payload),
          source: input.source,
          timeWindow: input.timeWindow,
          fetchedAt,
          expiresAt,
          degraded: this.extractDegradedFlag(input.payload),
          degradeReason: this.extractDegradeReason(input.payload),
        },
        create: {
          assetId: asset.id,
          dataType: input.dataType,
          timeWindow: input.timeWindow,
          source: input.source,
          cacheKey: input.cacheKey,
          payload: this.toInputJsonValue(input.payload),
          fetchedAt,
          expiresAt,
          degraded: this.extractDegradedFlag(input.payload),
          degradeReason: this.extractDegradeReason(input.payload),
        },
      });
    } catch (error) {
      this.disableDb('snapshot store', error);
    }
  }

  private touchSnapshot(id: string): void {
    if (!this.isDbReady()) {
      return;
    }

    void this.prisma.dataSnapshot
      .update({
        where: { id },
        data: {
          lastAccessedAt: new Date(),
          hitCount: { increment: 1 },
        },
      })
      .catch((error: unknown) => {
        this.disableDb('snapshot touch', error);
      });
  }

  private buildCacheKey(input: {
    dataType: ReadThroughCacheInput<unknown>['dataType'];
    identity: AnalyzeIdentity;
    source: string;
    timeWindow?: '24h' | '7d';
  }): string {
    const tokenAddress = this.normalizeTokenAddress(input.identity.tokenAddress);
    return [
      input.dataType,
      input.identity.sourceId.trim().toLowerCase(),
      input.identity.chain.trim().toLowerCase(),
      tokenAddress ?? 'native',
      input.timeWindow ?? 'na',
      input.source.trim().toLowerCase(),
    ].join(':');
  }

  private normalizeTokenAddress(tokenAddress: string | null | undefined): string | null {
    const normalized = tokenAddress?.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  private buildAssetMetadata(identity: AnalyzeIdentity): Prisma.InputJsonValue {
    return this.toInputJsonValue({
      sourceId: identity.sourceId,
      symbol: identity.symbol,
      chain: identity.chain,
    });
  }

  private toInputJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private extractDegradedFlag(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    return Boolean((payload as { degraded?: unknown }).degraded);
  }

  private extractDegradeReason(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const value = (payload as { degradeReason?: unknown }).degradeReason;
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private isFresh(expiresAt: Date, nowMs: number): boolean {
    return expiresAt.getTime() > nowMs;
  }

  private isWithinSwr(
    expiresAt: Date,
    policy: CachePolicyResolved,
    nowMs: number,
  ): boolean {
    return (
      policy.staleWhileRevalidateSeconds > 0 &&
      expiresAt.getTime() + policy.staleWhileRevalidateSeconds * 1000 > nowMs
    );
  }

  private isWithinMaxStale(
    expiresAt: Date,
    policy: CachePolicyResolved,
    nowMs: number,
  ): boolean {
    return (
      policy.maxStaleSeconds > 0 &&
      expiresAt.getTime() + policy.maxStaleSeconds * 1000 > nowMs
    );
  }

  private isDbReady(): boolean {
    return this.prisma.isConfigured() && !this.dbUnavailable;
  }

  private disableDb(operation: string, error: unknown): void {
    if (this.dbUnavailable) {
      return;
    }

    this.dbUnavailable = true;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Data cache disabled after ${operation}: ${message}`);
  }
}

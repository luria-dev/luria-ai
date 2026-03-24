import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/persistence/prisma.service';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';
import type { CachePolicyResolved, CacheableDataType } from './cache.types';

const DEFAULT_POLICIES: Record<
  CacheableDataType,
  Pick<
    CachePolicyResolved,
    'ttlSeconds' | 'staleWhileRevalidateSeconds' | 'maxStaleSeconds'
  >
> = {
  fundamentals: {
    ttlSeconds: 86400,
    staleWhileRevalidateSeconds: 86400,
    maxStaleSeconds: 604800,
  },
  tokenomics: {
    ttlSeconds: 86400,
    staleWhileRevalidateSeconds: 86400,
    maxStaleSeconds: 604800,
  },
  security: {
    ttlSeconds: 21600,
    staleWhileRevalidateSeconds: 21600,
    maxStaleSeconds: 86400,
  },
  sentiment: {
    ttlSeconds: 3600,
    staleWhileRevalidateSeconds: 1800,
    maxStaleSeconds: 7200,
  },
  onchain: {
    ttlSeconds: 1800,
    staleWhileRevalidateSeconds: 600,
    maxStaleSeconds: 3600,
  },
  identity_search: {
    ttlSeconds: 86400,
    staleWhileRevalidateSeconds: 86400,
    maxStaleSeconds: 604800,
  },
};

@Injectable()
export class CachePolicyService {
  private readonly logger = new Logger(CachePolicyService.name);
  private dbUnavailable = false;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    dataType: CacheableDataType,
    objective: IntentOutput['objective'],
    taskType: IntentOutput['taskType'],
  ): Promise<CachePolicyResolved> {
    const fallback = this.buildDefaultPolicy(dataType);

    if (!this.prisma.isConfigured() || this.dbUnavailable) {
      return fallback;
    }

    try {
      const record = await this.prisma.cachePolicy.findFirst({
        where: {
          dataType,
          objective,
          taskType,
          enabled: true,
        },
      });

      if (!record) {
        return fallback;
      }

      return {
        dataType,
        ttlSeconds: record.ttlSeconds,
        staleWhileRevalidateSeconds: record.staleWhileRevalidateSeconds,
        maxStaleSeconds: record.maxStaleSeconds,
        enabled: record.enabled,
        source: 'database',
      };
    } catch (error) {
      this.dbUnavailable = true;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache policy DB lookup disabled: ${message}`);
      return fallback;
    }
  }

  private buildDefaultPolicy(
    dataType: CacheableDataType,
  ): CachePolicyResolved {
    const policy = DEFAULT_POLICIES[dataType];
    return {
      dataType,
      ttlSeconds: policy.ttlSeconds,
      staleWhileRevalidateSeconds: policy.staleWhileRevalidateSeconds,
      maxStaleSeconds: policy.maxStaleSeconds,
      enabled: true,
      source: 'default',
    };
  }
}

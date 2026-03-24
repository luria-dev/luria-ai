import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import type { IntentOutput } from '../../../data/contracts/workflow-contracts';

export const CACHEABLE_DATA_TYPES = [
  'fundamentals',
  'tokenomics',
  'security',
  'sentiment',
  'onchain',
  'identity_search',
] as const;

export type CacheableDataType = (typeof CACHEABLE_DATA_TYPES)[number];

export type CachePolicyResolved = {
  dataType: CacheableDataType;
  ttlSeconds: number;
  staleWhileRevalidateSeconds: number;
  maxStaleSeconds: number;
  enabled: boolean;
  source: 'database' | 'default';
};

export type ReadThroughCacheInput<T> = {
  dataType: CacheableDataType;
  identity: AnalyzeIdentity;
  objective: IntentOutput['objective'];
  taskType: IntentOutput['taskType'];
  timeWindow?: '24h' | '7d';
  source: string;
  fetcher: () => Promise<T>;
};

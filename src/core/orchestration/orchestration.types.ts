import type {
  AnalyzeCandidate,
  AnalyzeIdentity,
  StrategyVerdict,
} from '../../data/contracts/analyze-contracts';
import type {
  IntentOutput,
  WorkflowNodeExecutionMeta,
  WorkflowRunResult,
} from '../../data/contracts/workflow-contracts';

export type RequestTarget = {
  targetKey: string;
  targetQuery: string;
  status: 'resolved' | 'waiting_selection' | 'not_found';
  identity?: AnalyzeIdentity;
  candidates: AnalyzeCandidate[];
  selectedCandidateId?: string;
};

export type RequestState = {
  requestId: string;
  status: 'pending' | 'waiting_selection' | 'ready' | 'failed';
  threadId: string | null;
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  targets: RequestTarget[];
  candidates: AnalyzeCandidate[];
  selectedCandidateId?: string;
  identity?: AnalyzeIdentity;
  intentHint?: IntentOutput;
  intentMeta?: WorkflowNodeExecutionMeta;
  errorCode?: 'NOT_FOUND' | 'REQUEST_NOT_FOUND' | 'INVALID_SELECTION';
  payload: Record<string, unknown>;
};

export type AnalyzeJobTarget = {
  targetKey: string;
  identity: AnalyzeIdentity;
};

export type AnalyzeJobData = {
  requestId: string;
  threadId: string | null;
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  targets: AnalyzeJobTarget[];
  intentHint?: IntentOutput;
  intentMeta?: WorkflowNodeExecutionMeta;
};

export type TargetPipeline = {
  targetKey: string;
  identity: AnalyzeIdentity;
  pipeline: WorkflowRunResult;
};

export type ComparisonRankItem = {
  targetKey: string;
  symbol: string;
  chain: string;
  verdict: StrategyVerdict;
  confidence: number;
  score: number;
  reasons: string[];
};

export type ComparisonSummary = {
  winner: ComparisonRankItem | null;
  ranked: ComparisonRankItem[];
  summary: string;
};

export type RequestStatus = RequestState['status'];

export type AnalyzeStreamEventName =
  | 'snapshot'
  | 'queued'
  | 'job_started'
  | 'intent_started'
  | 'intent_done'
  | 'target_resolution_started'
  | 'target_resolution_done'
  | 'selection_required'
  | 'workflow_started'
  | 'planning_started'
  | 'planning_done'
  | 'executor_started'
  | 'executor_done'
  | 'risk_strategy_started'
  | 'risk_strategy_done'
  | 'analysis_started'
  | 'analysis_done'
  | 'report_started'
  | 'report_done'
  | 'completed'
  | 'failed';

export type AnalyzeStreamEvent = {
  requestId: string;
  event: AnalyzeStreamEventName;
  status: RequestStatus;
  timestamp: string;
  data?: Record<string, unknown>;
};

export type QueueMode = 'bullmq' | 'inline_fallback';

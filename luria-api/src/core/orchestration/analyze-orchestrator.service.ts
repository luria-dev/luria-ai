import { Injectable, Logger, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Observable, Subject } from 'rxjs';
import {
  AnalyzeCandidate,
  AnalyzeBootstrapResponse,
  AnalyzeIdentity,
  AnalyzeResultResponse,
  AnalyzeSelectResponse,
  ModuleReadiness,
  StrategyVerdict,
} from '../contracts/analyze-contracts';
import { SearcherService } from '../../modules/searcher/searcher.service';
import { MarketService } from '../../modules/market/market.service';
import { TokenomicsService } from '../../modules/tokenomics/tokenomics.service';
import { TechnicalService } from '../../modules/technical/technical.service';
import { OnchainService } from '../../modules/onchain/onchain.service';
import { SentimentService } from '../../modules/sentiment/sentiment.service';
import { SecurityService } from '../../modules/security/security.service';
import { LiquidityService } from '../../modules/liquidity/liquidity.service';
import { AlertsService } from '../../modules/alerts/alerts.service';
import { StrategyService } from '../../modules/strategy/strategy.service';
import { ReporterService } from '../../modules/reporter/reporter.service';
import { NewsService } from '../../modules/news/news.service';
import {
  AnalysisWorkflowService,
  WorkflowStageEvent,
} from '../../modules/workflow/analysis-workflow.service';
import { IntentMemoService } from '../../modules/workflow/intent-memo.service';
import {
  IntentOutput,
  ReportOutput,
  WorkflowRunResult,
} from '../contracts/workflow-contracts';

type RequestTarget = {
  targetKey: string;
  targetQuery: string;
  status: 'resolved' | 'waiting_selection' | 'not_found';
  identity?: AnalyzeIdentity;
  candidates: AnalyzeCandidate[];
  selectedCandidateId?: string;
};

type RequestState = {
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
  errorCode?: 'NOT_FOUND' | 'REQUEST_NOT_FOUND' | 'INVALID_SELECTION';
  payload: Record<string, unknown>;
};

type AnalyzeJobTarget = {
  targetKey: string;
  identity: AnalyzeIdentity;
};

type AnalyzeJobData = {
  requestId: string;
  threadId: string | null;
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  targets: AnalyzeJobTarget[];
  intentHint?: IntentOutput;
};

type TargetPipeline = {
  targetKey: string;
  identity: AnalyzeIdentity;
  pipeline: WorkflowRunResult;
};

type ComparisonRankItem = {
  targetKey: string;
  symbol: string;
  chain: string;
  verdict: StrategyVerdict;
  confidence: number;
  score: number;
  reasons: string[];
};

type ComparisonSummary = {
  winner: ComparisonRankItem | null;
  ranked: ComparisonRankItem[];
  summary: string;
};

type RequestStatus = RequestState['status'];

type AnalyzeStreamEventName =
  | 'snapshot'
  | 'queued'
  | 'job_started'
  | 'intent_done'
  | 'planning_done'
  | 'executor_done'
  | 'risk_strategy_done'
  | 'analysis_done'
  | 'report_done'
  | 'completed'
  | 'failed';

type AnalyzeStreamEvent = {
  requestId: string;
  event: AnalyzeStreamEventName;
  status: RequestStatus;
  timestamp: string;
  data?: Record<string, unknown>;
};

@Injectable()
export class AnalyzeOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyzeOrchestratorService.name);
  private readonly requests = new Map<string, RequestState>();
  private readonly requestEventStreams = new Map<string, Subject<AnalyzeStreamEvent>>();
  private queue?: Queue<AnalyzeJobData>;
  private worker?: Worker<AnalyzeJobData>;
  private queueInitPromise?: Promise<boolean>;
  private queueEnabled = false;

  constructor(
    private readonly searcher: SearcherService,
    private readonly market: MarketService,
    private readonly news: NewsService,
    private readonly tokenomics: TokenomicsService,
    private readonly technical: TechnicalService,
    private readonly onchain: OnchainService,
    private readonly sentiment: SentimentService,
    private readonly security: SecurityService,
    private readonly liquidity: LiquidityService,
    private readonly alerts: AlertsService,
    private readonly strategy: StrategyService,
    private readonly reporter: ReporterService,
    private readonly workflow: AnalysisWorkflowService,
    private readonly intentMemo: IntentMemoService,
  ) {}

  async bootstrap(
    query: string,
    timeWindow: '24h' | '7d' = '24h',
    preferredChain: string | null = null,
    threadId: string | null = null,
  ): Promise<AnalyzeBootstrapResponse> {
    const requestId = randomUUID();
    const normalizedThreadId = threadId?.trim() ? threadId.trim() : null;
    const memo = normalizedThreadId ? this.intentMemo.get(normalizedThreadId) : null;
    const intentHint = await this.workflow.parseIntent({
      query,
      timeWindow,
      preferredChain,
      memo,
    });
    const targetResults = await this.searcher.resolveMany(query, preferredChain, {
      taskType: intentHint.taskType,
      entities: intentHint.entities,
    });
    const targets = targetResults.map<RequestTarget>((item) => {
      if (item.result.kind === 'resolved') {
        return {
          targetKey: item.targetKey,
          targetQuery: item.targetQuery,
          status: 'resolved',
          identity: item.result.identity,
          candidates: [],
        };
      }

      if (item.result.kind === 'ambiguous') {
        return {
          targetKey: item.targetKey,
          targetQuery: item.targetQuery,
          status: 'waiting_selection',
          candidates: item.result.candidates,
        };
      }

      return {
        targetKey: item.targetKey,
        targetQuery: item.targetQuery,
        status: 'not_found',
        candidates: [],
      };
    });

    const notFoundTargets = targets.filter((item) => item.status === 'not_found');
    const pendingTargets = targets.filter((item) => item.status === 'waiting_selection');
    const resolvedTargets = targets.filter((item) => item.status === 'resolved');
    const pendingCandidates = this.flattenPendingCandidates(targets);
    const primaryIdentity = resolvedTargets[0]?.identity;

    if (resolvedTargets.length === 0 && pendingTargets.length === 0) {
      this.requests.set(requestId, {
        requestId,
        status: 'failed',
        threadId: normalizedThreadId,
        query,
        timeWindow,
        preferredChain,
        targets,
        candidates: [],
        intentHint,
        errorCode: 'NOT_FOUND',
        payload: {
          errorCode: 'NOT_FOUND',
          intent: intentHint,
          memoUsed: Boolean(memo),
          threadId: normalizedThreadId,
          notFoundTargets: notFoundTargets.map((item) => item.targetKey),
          architecture: this.getModuleReadiness(),
        },
      });

      return {
        status: 'failed',
        requestId,
        errorCode: 'NOT_FOUND',
        message: 'No token candidates found for the query.',
      };
    }

    if (targets.length > 1 && notFoundTargets.length > 0) {
      this.requests.set(requestId, {
        requestId,
        status: 'failed',
        threadId: normalizedThreadId,
        query,
        timeWindow,
        preferredChain,
        targets,
        candidates: [],
        intentHint,
        errorCode: 'NOT_FOUND',
        payload: {
          errorCode: 'NOT_FOUND',
          intent: intentHint,
          memoUsed: Boolean(memo),
          threadId: normalizedThreadId,
          notFoundTargets: notFoundTargets.map((item) => item.targetKey),
          resolvedTargets: resolvedTargets.map((item) => ({
            targetKey: item.targetKey,
            identity: item.identity,
          })),
          architecture: this.getModuleReadiness(),
        },
      });
      return {
        status: 'failed',
        requestId,
        errorCode: 'NOT_FOUND',
        message: `Some targets are not found: ${notFoundTargets
          .map((item) => item.targetKey)
          .join(', ')}.`,
      };
    }

    if (pendingTargets.length > 0) {
      this.requests.set(requestId, {
        requestId,
        status: 'waiting_selection',
        threadId: normalizedThreadId,
        query,
        timeWindow,
        preferredChain,
        targets,
        candidates: pendingCandidates,
        identity: primaryIdentity,
        intentHint,
        payload: {
          intent: intentHint,
          memoUsed: Boolean(memo),
          threadId: normalizedThreadId,
          architecture: this.getModuleReadiness(),
          pendingTargets: pendingTargets.map((item) => item.targetKey),
          resolvedTargets: resolvedTargets.map((item) => ({
            targetKey: item.targetKey,
            identity: item.identity,
          })),
        },
      });

      return {
        status: 'accepted',
        requestId,
        nextAction: 'select_candidate',
        message:
          pendingTargets.length > 1
            ? `Multiple targets need candidate selection: ${pendingTargets
                .map((item) => item.targetKey)
                .join(', ')}.`
            : 'Multiple candidates found. User selection is required.',
        candidates: pendingCandidates,
      };
    }

    const readyTargets = this.getResolvedJobTargets(targets);
    this.requests.set(requestId, {
      requestId,
      status: 'pending',
      threadId: normalizedThreadId,
      query,
      timeWindow,
      preferredChain,
      targets,
      candidates: [],
      identity: primaryIdentity,
      intentHint,
      payload: {
        query,
        timeWindow,
        intent: intentHint,
        memoUsed: Boolean(memo),
        threadId: normalizedThreadId,
        identity: primaryIdentity,
        targets: readyTargets,
        architecture: this.getModuleReadiness(),
        note: 'Analyze job is queued and waiting for worker execution.',
      },
    });
    const queueMode = await this.enqueueAnalyzeJob({
      requestId,
      threadId: normalizedThreadId,
      query,
      timeWindow,
      preferredChain,
      targets: readyTargets,
      intentHint,
    });
    this.emitEvent(requestId, 'queued', 'pending', {
      queueMode,
      targetCount: readyTargets.length,
    });

    return {
      status: 'accepted',
      requestId,
      nextAction: 'run_pipeline',
      message: 'Analyze job accepted and queued for execution.',
      payload: {
        intent: intentHint,
        memoUsed: Boolean(memo),
        threadId: normalizedThreadId,
        identity: primaryIdentity,
        targets: readyTargets,
        queue: {
          mode: queueMode,
        },
      },
    };
  }

  async select(
    requestId: string,
    candidateId: string,
    targetKey: string | null = null,
  ): Promise<AnalyzeSelectResponse> {
    const existing = this.requests.get(requestId);

    if (!existing) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      };
    }

    const pendingTargets = existing.targets.filter((target) => target.status === 'waiting_selection');
    if (pendingTargets.length === 0) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'No pending candidate selection for this request.',
      };
    }

    let targetToSelect: RequestTarget | undefined;
    if (targetKey) {
      targetToSelect = pendingTargets.find((target) => target.targetKey === targetKey);
    } else {
      targetToSelect = pendingTargets.find((target) =>
        target.candidates.some((candidate) => candidate.candidateId === candidateId),
      );
      if (!targetToSelect && pendingTargets.length > 1) {
        return {
          status: 'failed',
          requestId,
          nextAction: 'invalid_selection',
          errorCode: 'TARGET_KEY_REQUIRED',
          message: 'Multiple target selections are pending. Please provide target_key.',
        };
      }
    }

    if (!targetToSelect) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'Target key is invalid for this request.',
      };
    }

    const candidateValidForTarget = targetToSelect.candidates.some(
      (candidate) => candidate.candidateId === candidateId,
    );
    if (!candidateValidForTarget) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'Candidate does not belong to the selected target.',
      };
    }

    const resolvedIdentity = this.searcher.resolveCandidateById(candidateId);
    if (!resolvedIdentity) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'Candidate is invalid.',
      };
    }

    targetToSelect.status = 'resolved';
    targetToSelect.identity = resolvedIdentity;
    targetToSelect.selectedCandidateId = candidateId;
    targetToSelect.candidates = [];
    existing.selectedCandidateId = candidateId;
    const remainingPendingTargets = existing.targets.filter(
      (target) => target.status === 'waiting_selection',
    );
    const readyTargets = this.getResolvedJobTargets(existing.targets);
    existing.identity = readyTargets[0]?.identity ?? resolvedIdentity;
    existing.candidates = this.flattenPendingCandidates(existing.targets);

    if (remainingPendingTargets.length > 0) {
      existing.status = 'waiting_selection';
      existing.payload = {
        ...existing.payload,
        selectedCandidateId: candidateId,
        selectedTargetKey: targetToSelect.targetKey,
        identity: existing.identity,
        targets: readyTargets,
        pendingTargets: remainingPendingTargets.map((target) => target.targetKey),
        note: 'Selection recorded. More target selections are required before queueing.',
      };

      return {
        status: 'accepted',
        requestId,
        nextAction: 'selection_recorded',
        message: `Selection accepted for ${targetToSelect.targetKey}. Waiting for remaining targets: ${remainingPendingTargets
          .map((target) => target.targetKey)
          .join(', ')}.`,
        payload: {
          pendingTargets: remainingPendingTargets.map((target) => target.targetKey),
        },
      };
    }

    existing.status = 'pending';
    existing.payload = {
      ...existing.payload,
      selectedCandidateId: candidateId,
      selectedTargetKey: targetToSelect.targetKey,
      identity: existing.identity,
      targets: readyTargets,
      note: 'Selection recorded. Analyze job is queued and waiting for worker execution.',
    };

    if (readyTargets.length === 0) {
      existing.status = 'failed';
      existing.errorCode = 'INVALID_SELECTION';
      existing.payload = {
        ...existing.payload,
        errorCode: 'INVALID_SELECTION',
        errorMessage: 'No resolved targets after selection.',
      };
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'No resolved targets available for analysis.',
      };
    }

    const queueMode = await this.enqueueAnalyzeJob({
      requestId,
      threadId: existing.threadId,
      query: existing.query,
      timeWindow: existing.timeWindow,
      preferredChain: existing.preferredChain,
      targets: readyTargets,
      intentHint: existing.intentHint,
    });
    this.emitEvent(requestId, 'queued', 'pending', {
      queueMode,
      targetCount: readyTargets.length,
    });

    return {
      status: 'accepted',
      requestId,
      nextAction: 'selection_recorded',
      message: `Selection accepted. Job queued (${queueMode}) for ${readyTargets.length} target(s).`,
    };
  }

  getResult(requestId: string): AnalyzeResultResponse {
    const existing = this.requests.get(requestId);

    if (!existing) {
      return {
        status: 'failed',
        requestId,
        message: 'Request not found.',
        payload: {
          errorCode: 'REQUEST_NOT_FOUND',
        },
      };
    }

    return {
      status: existing.status,
      requestId,
      message:
        existing.status === 'ready'
          ? 'Pipeline skeleton ready.'
          : existing.status === 'waiting_selection'
            ? 'Waiting for candidate selection.'
            : existing.status === 'failed'
              ? 'Pipeline failed.'
              : 'Pipeline pending.',
      payload: {
        ...existing.payload,
        threadId: existing.threadId,
        query: existing.query,
        timeWindow: existing.timeWindow,
        preferredChain: existing.preferredChain,
        targets: existing.targets,
        candidates: existing.candidates,
        selectedCandidateId: existing.selectedCandidateId,
        identity: existing.identity,
        errorCode: existing.errorCode,
      },
    };
  }

  stream(requestId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const request = this.requests.get(requestId);
      if (!request) {
        subscriber.next(
          this.toMessageEvent({
            requestId,
            event: 'failed',
            status: 'failed',
            timestamp: new Date().toISOString(),
            data: {
              errorCode: 'REQUEST_NOT_FOUND',
            },
          }),
        );
        subscriber.complete();
        return undefined;
      }

      subscriber.next(this.toMessageEvent(this.toSnapshotEvent(request)));

      if (request.status === 'ready' || request.status === 'failed') {
        subscriber.complete();
        return undefined;
      }

      const stream = this.getOrCreateEventStream(requestId);
      const subscription = stream.subscribe({
        next: (event) => subscriber.next(this.toMessageEvent(event)),
        complete: () => subscriber.complete(),
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  getModuleReadiness(): ModuleReadiness[] {
    return [
      this.searcher.getStatus(),
      this.market.getStatus(),
      this.news.getStatus(),
      this.tokenomics.getStatus(),
      this.technical.getStatus(),
      this.onchain.getStatus(),
      this.sentiment.getStatus(),
      this.security.getStatus(),
      this.liquidity.getStatus(),
      this.alerts.getStatus(),
      this.strategy.getStatus(),
      this.reporter.getStatus(),
      this.workflow.getStatus(),
    ];
  }

  private async runWorkflow(
    query: string,
    preferredChain: string | null,
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d',
    onStageCompleted?: (event: WorkflowStageEvent) => void,
    intentOverride?: IntentOutput,
  ) {
    return this.workflow.run({
      query,
      preferredChain,
      identity,
      timeWindow,
    }, {
      onStageCompleted,
      intentOverride,
    });
  }

  private async enqueueAnalyzeJob(data: AnalyzeJobData): Promise<'bullmq' | 'inline_fallback'> {
    const ready = await this.ensureQueue();
    if (!ready || !this.queue) {
      setImmediate(() => {
        void this.processAnalyzeJob(data);
      });
      return 'inline_fallback';
    }

    await this.queue.add('analyze', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    return 'bullmq';
  }

  private async processAnalyzeJob(data: AnalyzeJobData): Promise<void> {
    const request = this.requests.get(data.requestId);
    if (!request) {
      return;
    }

    this.emitEvent(data.requestId, 'job_started', 'pending', {
      queue: this.queueEnabled ? 'bullmq' : 'inline_fallback',
      targetCount: data.targets.length,
    });

    try {
      const memoForJob =
        data.threadId && data.threadId.trim().length > 0
          ? this.intentMemo.get(data.threadId)
          : null;
      const orchestrationIntent =
        data.intentHint ??
        (await this.workflow.parseIntent({
          query: data.query,
          timeWindow: data.timeWindow,
          preferredChain: data.preferredChain,
          memo: memoForJob,
        }));
      this.emitEvent(data.requestId, 'intent_done', 'pending', {
        taskType: orchestrationIntent.taskType,
        entities: orchestrationIntent.entities,
        focusAreas: orchestrationIntent.focusAreas,
      });

      const targetPipelines: TargetPipeline[] = [];
      for (const target of data.targets) {
        const pipeline = await this.runWorkflow(
          data.query,
          data.preferredChain,
          target.identity,
          data.timeWindow,
          (stageEvent) => {
            this.emitEvent(
              data.requestId,
              this.stageEventToStreamEvent(stageEvent),
              'pending',
              {
                stage: stageEvent.stage,
                stageTimestamp: stageEvent.timestamp,
                targetKey: target.targetKey,
                symbol: target.identity.symbol,
                chain: target.identity.chain,
              },
            );
          },
          orchestrationIntent,
        );
        targetPipelines.push({
          targetKey: target.targetKey,
          identity: target.identity,
          pipeline,
        });
      }

      if (targetPipelines.length === 0) {
        throw new Error('No resolved analysis targets available for job execution.');
      }

      const shouldCompare = this.shouldBuildComparison(orchestrationIntent, targetPipelines.length);
      const comparison = shouldCompare
        ? this.buildComparisonSummary(data.query, targetPipelines)
        : null;
      const primaryPipeline = shouldCompare
        ? comparison?.winner
          ? targetPipelines.find(
              (item) =>
                item.targetKey === comparison.winner?.targetKey &&
                item.identity.symbol === comparison.winner?.symbol &&
                item.identity.chain === comparison.winner?.chain,
            )?.pipeline ?? targetPipelines[0].pipeline
          : targetPipelines[0].pipeline
        : targetPipelines[0].pipeline;
      const primaryIdentity = shouldCompare
        ? comparison?.winner
          ? targetPipelines.find(
              (item) =>
                item.targetKey === comparison.winner?.targetKey &&
                item.identity.symbol === comparison.winner?.symbol &&
                item.identity.chain === comparison.winner?.chain,
            )?.identity ?? targetPipelines[0].identity
          : targetPipelines[0].identity
        : targetPipelines[0].identity;
      const report =
        targetPipelines.length > 1
          ? shouldCompare && comparison
            ? this.buildComparisonReport(targetPipelines, comparison)
            : this.buildMultiTargetBundleReport(targetPipelines, orchestrationIntent)
          : primaryPipeline.report;

      const current = this.requests.get(data.requestId);
      if (!current) {
        return;
      }

      current.status = 'ready';
      current.identity = primaryIdentity;
      current.payload = {
        ...current.payload,
        query: data.query,
        timeWindow: data.timeWindow,
        identity: primaryIdentity,
        ...primaryPipeline,
        intent: orchestrationIntent,
        report,
        multiTarget: targetPipelines.length > 1,
        targetCount: targetPipelines.length,
        orchestration: {
          taskType: orchestrationIntent.taskType,
          compareApplied: shouldCompare,
          entities: orchestrationIntent.entities,
          memoThreadId: data.threadId,
        },
        targetPipelines: targetPipelines.map((item) => ({
          targetKey: item.targetKey,
          identity: item.identity,
          intent: item.pipeline.intent,
          plan: item.pipeline.plan,
          execution: item.pipeline.execution,
          alerts: item.pipeline.alerts,
          strategy: item.pipeline.strategy,
          analysis: item.pipeline.analysis,
          report: item.pipeline.report,
        })),
        comparison,
        architecture: this.getModuleReadiness(),
        note:
          targetPipelines.length > 1 && shouldCompare
            ? 'Multi-target pipeline completed with intent-driven comparison.'
            : targetPipelines.length > 1
              ? 'Multi-target pipeline completed with per-token execution (no comparison requested).'
            : 'Pipeline completed by worker with LangGraph orchestration.',
      };

      if (data.threadId && data.threadId.trim().length > 0) {
        this.intentMemo.save({
          threadId: data.threadId,
          intent: orchestrationIntent,
          resolvedTargets: data.targets,
          requestId: data.requestId,
        });
      }
      this.emitEvent(data.requestId, 'completed', 'ready');
      this.completeEventStream(data.requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Analyze job failed (${data.requestId}): ${message}`);
      const current = this.requests.get(data.requestId);
      if (!current) {
        return;
      }

      current.status = 'failed';
      current.payload = {
        ...current.payload,
        query: data.query,
        timeWindow: data.timeWindow,
        targets: data.targets,
        errorCode: 'WORKFLOW_EXECUTION_FAILED',
        errorMessage: message,
        architecture: this.getModuleReadiness(),
      };
      this.emitEvent(data.requestId, 'failed', 'failed', {
        errorMessage: message,
      });
      this.completeEventStream(data.requestId);
    }
  }

  private stageEventToStreamEvent(event: WorkflowStageEvent): AnalyzeStreamEventName {
    const mapping: Record<WorkflowStageEvent['stage'], AnalyzeStreamEventName> = {
      intent: 'intent_done',
      planning: 'planning_done',
      executor: 'executor_done',
      risk_strategy: 'risk_strategy_done',
      analysis: 'analysis_done',
      report: 'report_done',
    };
    return mapping[event.stage];
  }

  private emitEvent(
    requestId: string,
    event: AnalyzeStreamEventName,
    status: RequestStatus,
    data?: Record<string, unknown>,
  ): void {
    const stream = this.getOrCreateEventStream(requestId);
    stream.next({
      requestId,
      event,
      status,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  private toSnapshotEvent(request: RequestState): AnalyzeStreamEvent {
    return {
      requestId: request.requestId,
      event: 'snapshot',
      status: request.status,
      timestamp: new Date().toISOString(),
      data: {
        threadId: request.threadId,
        query: request.query,
        timeWindow: request.timeWindow,
        preferredChain: request.preferredChain,
        targets: request.targets,
        pendingTargets: request.targets
          .filter((target) => target.status === 'waiting_selection')
          .map((target) => target.targetKey),
        selectedCandidateId: request.selectedCandidateId,
        identity: request.identity,
        errorCode: request.errorCode,
      },
    };
  }

  private toMessageEvent(event: AnalyzeStreamEvent): MessageEvent {
    return {
      type: event.event,
      data: event,
      id: `${event.requestId}:${event.timestamp}`,
    };
  }

  private getOrCreateEventStream(requestId: string): Subject<AnalyzeStreamEvent> {
    const existing = this.requestEventStreams.get(requestId);
    if (existing) {
      return existing;
    }

    const stream = new Subject<AnalyzeStreamEvent>();
    this.requestEventStreams.set(requestId, stream);
    return stream;
  }

  private completeEventStream(requestId: string): void {
    const stream = this.requestEventStreams.get(requestId);
    if (!stream) {
      return;
    }
    stream.complete();
    this.requestEventStreams.delete(requestId);
  }

  private flattenPendingCandidates(targets: RequestTarget[]): AnalyzeCandidate[] {
    return targets
      .filter((target) => target.status === 'waiting_selection')
      .flatMap((target) =>
        target.candidates.map((candidate) => ({
          ...candidate,
          targetKey: target.targetKey,
        })),
      );
  }

  private getResolvedJobTargets(targets: RequestTarget[]): AnalyzeJobTarget[] {
    return targets
      .filter((target) => target.status === 'resolved' && target.identity)
      .map((target) => ({
        targetKey: target.targetKey,
        identity: target.identity as AnalyzeIdentity,
      }));
  }

  private shouldBuildComparison(intent: IntentOutput, targetCount: number): boolean {
    return intent.taskType === 'comparison' && targetCount >= 2;
  }

  private buildComparisonSummary(query: string, targets: TargetPipeline[]): ComparisonSummary {
    const ranked = targets
      .map((target) => {
        const score = this.scoreTargetPipeline(target.pipeline);
        const reasons: string[] = [];
        reasons.push(`strategy=${target.pipeline.strategy.verdict}`);
        reasons.push(`confidence=${target.pipeline.strategy.confidence.toFixed(2)}`);
        reasons.push(
          `alerts(red=${target.pipeline.alerts.redCount},yellow=${target.pipeline.alerts.yellowCount})`,
        );
        reasons.push(`degradedNodes=${target.pipeline.execution.degradedNodes.length}`);
        return {
          targetKey: target.targetKey,
          symbol: target.identity.symbol,
          chain: target.identity.chain,
          verdict: target.pipeline.strategy.verdict,
          confidence: target.pipeline.strategy.confidence,
          score,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0] ?? null;
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const summary = winner
      ? language === 'zh'
        ? `基于综合评分，${winner.symbol}(${winner.chain}) 在当前问题“${query}”中排名第一。`
        : `Based on aggregate scoring, ${winner.symbol} (${winner.chain}) ranks first for query "${query}".`
      : language === 'zh'
        ? '未能生成有效对比结果。'
        : 'No valid comparison result was produced.';

    return {
      winner,
      ranked,
      summary,
    };
  }

  private buildMultiTargetBundleReport(
    targets: TargetPipeline[],
    intent: IntentOutput,
  ): ReportOutput {
    const isZh = intent.language === 'zh';
    const points = targets.map((item) => {
      const verdict = item.pipeline.strategy.verdict;
      const confidence = item.pipeline.strategy.confidence.toFixed(2);
      return `${item.identity.symbol} (${item.identity.chain}): ${verdict}, confidence=${confidence}`;
    });

    return {
      title: isZh ? '多标的独立分析汇总' : 'Multi-Target Independent Analysis Bundle',
      executiveSummary: isZh
        ? '按用户意图执行了多标的独立分析，未触发对比模式。'
        : 'Independent analyses were executed for multiple targets; comparison mode was not requested.',
      sections: [
        {
          heading: isZh ? '执行结果' : 'Execution Results',
          points,
        },
      ],
      verdict: targets[0]?.pipeline.strategy.verdict ?? 'INSUFFICIENT_DATA',
      confidence: Number((targets[0]?.pipeline.strategy.confidence ?? 0).toFixed(2)),
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。'
        : 'This report is for research purposes only and is not investment advice.',
    };
  }

  private scoreTargetPipeline(pipeline: WorkflowRunResult): number {
    const verdictScore: Record<StrategyVerdict, number> = {
      BUY: 30,
      HOLD: 15,
      CAUTION: 5,
      SELL: -10,
      INSUFFICIENT_DATA: -20,
    };

    let score = verdictScore[pipeline.strategy.verdict] + pipeline.strategy.confidence * 40;
    score -= pipeline.alerts.redCount * 12;
    score -= pipeline.alerts.yellowCount * 4;
    score -= pipeline.execution.degradedNodes.length * 2;

    if (pipeline.execution.data.security.isHoneypot) {
      score -= 30;
    }
    if (pipeline.execution.data.security.riskLevel === 'critical') {
      score -= 20;
    }
    if (pipeline.execution.data.liquidity.withdrawalRiskFlag) {
      score -= 10;
    }

    return Number(score.toFixed(2));
  }

  private buildComparisonReport(
    targets: TargetPipeline[],
    comparison: ComparisonSummary,
  ): ReportOutput {
    const language = targets[0]?.pipeline.intent.language ?? 'en';
    const isZh = language === 'zh';
    const rankedPoints = comparison.ranked.map(
      (item, index) =>
        `${index + 1}. ${item.symbol} (${item.chain}) score=${item.score.toFixed(2)}, verdict=${
          item.verdict
        }, confidence=${item.confidence.toFixed(2)}`,
    );

    const riskPoints = targets.map((target) => {
      const risk = target.pipeline.alerts;
      return `${target.identity.symbol} (${target.identity.chain}) red=${risk.redCount}, yellow=${risk.yellowCount}`;
    });

    const winnerVerdict = comparison.winner?.verdict ?? 'INSUFFICIENT_DATA';
    const winnerConfidence = Number((comparison.winner?.confidence ?? 0).toFixed(2));

    return {
      title: isZh ? '多标的对比分析报告' : 'Multi-Target Comparison Report',
      executiveSummary: comparison.summary,
      sections: [
        {
          heading: isZh ? '综合排名' : 'Ranking',
          points: rankedPoints.length > 0 ? rankedPoints : [isZh ? '无有效候选。' : 'No valid targets.'],
        },
        {
          heading: isZh ? '风险对比' : 'Risk Comparison',
          points: riskPoints,
        },
        {
          heading: isZh ? '结论' : 'Conclusion',
          points: [comparison.summary],
        },
      ],
      verdict: winnerVerdict,
      confidence: winnerConfidence,
      disclaimer: isZh
        ? '本报告仅供研究参考，不构成投资建议。'
        : 'This report is for research purposes only and is not investment advice.',
    };
  }

  private async ensureQueue(): Promise<boolean> {
    if (this.queueEnabled) {
      return true;
    }
    if (this.queueInitPromise) {
      return this.queueInitPromise;
    }

    this.queueInitPromise = this.initQueue();
    const ok = await this.queueInitPromise;
    if (!ok) {
      this.queueInitPromise = undefined;
    }
    return ok;
  }

  private async initQueue(): Promise<boolean> {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    const password = process.env.REDIS_PASSWORD || undefined;
    const concurrency = Number(process.env.ANALYZE_QUEUE_CONCURRENCY ?? 4);
    const queueName = process.env.ANALYZE_QUEUE_NAME ?? 'analyze-jobs';
    const connection = {
      host,
      port,
      password,
      maxRetriesPerRequest: null as null,
    };

    try {
      this.queue = new Queue<AnalyzeJobData>(queueName, { connection });
      this.worker = new Worker<AnalyzeJobData>(
        queueName,
        async (job) => {
          await this.processAnalyzeJob(job.data);
        },
        {
          connection,
          concurrency,
        },
      );

      this.worker.on('failed', (job, error) => {
        const requestId = job?.data?.requestId;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Worker failed job ${requestId ?? 'unknown'}: ${message}`);
      });

      await this.queue.waitUntilReady();
      await this.worker.waitUntilReady();
      this.queueEnabled = true;
      this.logger.log(`Analyze queue enabled on ${host}:${port} (${queueName}).`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Queue unavailable, fallback to inline execution: ${message}`);
      await this.safeCloseQueueResources();
      this.queueEnabled = false;
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.safeCloseQueueResources();
    this.completeAllEventStreams();
  }

  private async safeCloseQueueResources(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch {
        // ignore shutdown error
      }
      this.worker = undefined;
    }

    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // ignore shutdown error
      }
      this.queue = undefined;
    }
  }

  private completeAllEventStreams(): void {
    for (const stream of this.requestEventStreams.values()) {
      stream.complete();
    }
    this.requestEventStreams.clear();
  }
}

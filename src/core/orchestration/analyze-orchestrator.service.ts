import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import {
  AnalyzeCandidate,
  AnalyzeBootstrapResponse,
  AnalyzeIdentity,
  AnalyzeResultResponse,
  AnalyzeSelectResponse,
  ModuleReadiness,
} from '../../data/contracts/analyze-contracts';
import { SearcherService } from '../../modules/data/searcher/searcher.service';
import { MarketService } from '../../modules/data/market/market.service';
import { TokenomicsService } from '../../modules/data/tokenomics/tokenomics.service';
import { TechnicalService } from '../../modules/data/technical/technical.service';
import { OnchainService } from '../../modules/data/onchain/onchain.service';
import { SentimentService } from '../../modules/data/sentiment/sentiment.service';
import { SecurityService } from '../../modules/data/security/security.service';
import { LiquidityService } from '../../modules/data/liquidity/liquidity.service';
import { AlertsService } from '../../modules/risk/alerts/alerts.service';
import { StrategyService } from '../../modules/strategy/strategy.service';
import { ReporterService } from '../../modules/reporter/reporter.service';
import { NewsService } from '../../modules/data/news/news.service';
import {
  AnalysisWorkflowService,
  WorkflowStageEvent,
} from '../../modules/workflow/engine/analysis-workflow.service';
import { IntentMemoService } from '../../modules/workflow/state/intent-memo.service';
import {
  IntentOutput,
} from '../../data/contracts/workflow-contracts';
import type {
  AnalyzeJobData,
  AnalyzeJobTarget,
  AnalyzeStreamEventName,
  RequestTarget,
  TargetPipeline,
} from './orchestration.types';
import { RequestStateService } from './services/request-state.service';
import { AnalyzeQueueService } from './services/analyze-queue.service';
import { ComparisonService } from './services/comparison.service';

@Injectable()
export class AnalyzeOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyzeOrchestratorService.name);

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
    private readonly requestState: RequestStateService,
    private readonly analyzeQueue: AnalyzeQueueService,
    private readonly comparison: ComparisonService,
  ) {}

  async bootstrap(
    query: string,
    timeWindow: '24h' | '7d' = '24h',
    preferredChain: string | null = null,
    threadId: string | null = null,
  ): Promise<AnalyzeBootstrapResponse> {
    const requestId = randomUUID();
    const normalizedThreadId = threadId?.trim() ? threadId.trim() : null;
    const memo = normalizedThreadId
      ? this.intentMemo.get(normalizedThreadId)
      : null;
    const intentHint = await this.workflow.parseIntent({
      query,
      timeWindow,
      preferredChain,
      memo,
    });
    const targetResults = await this.searcher.resolveMany(
      query,
      preferredChain,
      {
        taskType: intentHint.taskType,
        entities: intentHint.entities,
      },
    );
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

    const notFoundTargets = targets.filter(
      (item) => item.status === 'not_found',
    );
    const pendingTargets = targets.filter(
      (item) => item.status === 'waiting_selection',
    );
    const resolvedTargets = targets.filter(
      (item) => item.status === 'resolved',
    );
    const pendingCandidates = this.flattenPendingCandidates(targets);
    const primaryIdentity = resolvedTargets[0]?.identity;

    if (resolvedTargets.length === 0 && pendingTargets.length === 0) {
      this.requestState.set({
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
      this.requestState.set({
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
      this.requestState.set({
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
    this.requestState.set({
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
    this.requestState.emitEvent(requestId, 'queued', 'pending', {
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
    const existing = this.requestState.get(requestId);

    if (!existing) {
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      };
    }

    const pendingTargets = existing.targets.filter(
      (target) => target.status === 'waiting_selection',
    );
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
      targetToSelect = pendingTargets.find(
        (target) => target.targetKey === targetKey,
      );
    } else {
      targetToSelect = pendingTargets.find((target) =>
        target.candidates.some(
          (candidate) => candidate.candidateId === candidateId,
        ),
      );
      if (!targetToSelect && pendingTargets.length > 1) {
        return {
          status: 'failed',
          requestId,
          nextAction: 'invalid_selection',
          errorCode: 'TARGET_KEY_REQUIRED',
          message:
            'Multiple target selections are pending. Please provide target_key.',
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
        pendingTargets: remainingPendingTargets.map(
          (target) => target.targetKey,
        ),
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
          pendingTargets: remainingPendingTargets.map(
            (target) => target.targetKey,
          ),
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
    this.requestState.emitEvent(requestId, 'queued', 'pending', {
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
    const existing = this.requestState.get(requestId);

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
    return this.requestState.stream(requestId);
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
    return this.workflow.run(
      {
        query,
        preferredChain,
        identity,
        timeWindow,
      },
      {
        onStageCompleted,
        intentOverride,
      },
    );
  }

  private async enqueueAnalyzeJob(
    data: AnalyzeJobData,
  ): Promise<'bullmq' | 'inline_fallback'> {
    return this.analyzeQueue.enqueue(data, async (jobData) =>
      this.processAnalyzeJob(jobData),
    );
  }

  private async processAnalyzeJob(data: AnalyzeJobData): Promise<void> {
    const request = this.requestState.get(data.requestId);
    if (!request) {
      return;
    }

    this.requestState.emitEvent(data.requestId, 'job_started', 'pending', {
      queue: this.analyzeQueue.isQueueEnabled() ? 'bullmq' : 'inline_fallback',
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
      this.requestState.emitEvent(data.requestId, 'intent_done', 'pending', {
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
            this.requestState.emitEvent(
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
        throw new Error(
          'No resolved analysis targets available for job execution.',
        );
      }

      const shouldCompare = this.comparison.shouldBuildComparison(
        orchestrationIntent,
        targetPipelines.length,
      );
      const comparison = shouldCompare
        ? this.comparison.buildComparisonSummary(data.query, targetPipelines)
        : null;
      const primaryPipeline = shouldCompare
        ? comparison?.winner
          ? (targetPipelines.find(
              (item) =>
                item.targetKey === comparison.winner?.targetKey &&
                item.identity.symbol === comparison.winner?.symbol &&
                item.identity.chain === comparison.winner?.chain,
            )?.pipeline ?? targetPipelines[0].pipeline)
          : targetPipelines[0].pipeline
        : targetPipelines[0].pipeline;
      const primaryIdentity = shouldCompare
        ? comparison?.winner
          ? (targetPipelines.find(
              (item) =>
                item.targetKey === comparison.winner?.targetKey &&
                item.identity.symbol === comparison.winner?.symbol &&
                item.identity.chain === comparison.winner?.chain,
            )?.identity ?? targetPipelines[0].identity)
          : targetPipelines[0].identity
        : targetPipelines[0].identity;
      const report =
        targetPipelines.length > 1
          ? shouldCompare && comparison
            ? this.comparison.buildComparisonReport(
                targetPipelines,
                comparison,
              )
            : this.comparison.buildMultiTargetBundleReport(
                targetPipelines,
                orchestrationIntent,
              )
          : primaryPipeline.report;

      const current = this.requestState.get(data.requestId);
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
      this.requestState.emitEvent(data.requestId, 'completed', 'ready');
      this.requestState.completeEventStream(data.requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalizedError =
        error instanceof Error ? error : new Error(message);
      this.logger.error(
        `Analyze job failed (${data.requestId}).`,
        normalizedError,
      );
      const current = this.requestState.get(data.requestId);
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
      this.requestState.emitEvent(data.requestId, 'failed', 'failed', {
        errorMessage: message,
      });
      this.requestState.completeEventStream(data.requestId);
    }
  }

  private stageEventToStreamEvent(
    event: WorkflowStageEvent,
  ): AnalyzeStreamEventName {
    const mapping: Record<WorkflowStageEvent['stage'], AnalyzeStreamEventName> =
      {
        intent: 'intent_done',
        planning: 'planning_done',
        executor: 'executor_done',
        risk_strategy: 'risk_strategy_done',
        analysis: 'analysis_done',
        report: 'report_done',
      };
    return mapping[event.stage];
  }

  private flattenPendingCandidates(
    targets: RequestTarget[],
  ): AnalyzeCandidate[] {
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

  async onModuleDestroy(): Promise<void> {
    await this.analyzeQueue.shutdown();
    this.requestState.completeAllEventStreams();
  }
}

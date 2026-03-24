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
  AnalyzeSubmitResponse,
  ModuleReadiness,
} from '../../data/contracts/analyze-contracts';
import { SearcherService } from '../../modules/data/searcher/searcher.service';
import { MarketService } from '../../modules/data/market/market.service';
import { TokenomicsService } from '../../modules/data/tokenomics/tokenomics.service';
import { FundamentalsService } from '../../modules/data/fundamentals/fundamentals.service';
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
  WorkflowNodeExecutionMeta,
} from '../../data/contracts/workflow-contracts';
import type {
  AnalyzeJobData,
  AnalyzeJobTarget,
  AnalyzeStreamEventName,
  RequestState,
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
    private readonly fundamentals: FundamentalsService,
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

  async analyzeMessage(input: {
    message: string;
    requestId: string | null;
    threadId: string | null;
    timeWindow: '24h' | '7d';
    preferredChain: string | null;
  }): Promise<AnalyzeSubmitResponse> {
    const message = input.message.trim();
    if (!message) {
      return {
        status: 'failed',
        requestId: input.requestId ?? '',
        threadId: input.threadId,
        mode: input.requestId ? 'continued' : 'created',
        nextAction: 'clarify_input',
        errorCode: 'INVALID_SELECTION',
        message: 'Message is required.',
      };
    }

    if (!input.requestId) {
      const threadId = this.normalizeOrCreateThreadId(input.threadId);
      return this.toSubmitResponse(
        await this.bootstrap(
          message,
          input.timeWindow,
          input.preferredChain,
          threadId,
        ),
        threadId,
        'created',
      );
    }

    const existing = await this.requestState.get(input.requestId);
    if (!existing) {
      return {
        status: 'failed',
        requestId: input.requestId,
        threadId: input.threadId,
        mode: 'continued',
        nextAction: 'request_not_found',
        errorCode: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      };
    }

    const resolvedThreadId = this.normalizeOrCreateThreadId(
      existing.threadId ?? input.threadId,
    );

    if (existing.status === 'waiting_selection') {
      const candidateReply = this.resolveSelectionReply(existing, message);

      if (candidateReply.kind === 'matched') {
        return this.toSubmitResponse(
          await this.select(
            existing.requestId,
            candidateReply.candidateId,
            candidateReply.targetKey,
          ),
          resolvedThreadId,
          'continued',
        );
      }

      if (candidateReply.kind === 'clarify') {
        return {
          status: 'failed',
          requestId: existing.requestId,
          threadId: resolvedThreadId,
          mode: 'continued',
          nextAction: 'clarify_input',
          errorCode: 'AMBIGUOUS_USER_REPLY',
          message:
            'Could not map your reply to a candidate. Please answer with the token symbol or exact name.',
          payload: {
            candidates: existing.candidates,
            pendingTargets: existing.targets
              .filter((target) => target.status === 'waiting_selection')
              .map((target) => target.targetKey),
          },
        };
      }
    }

    return this.toSubmitResponse(
      await this.bootstrap(
        message,
        existing.timeWindow,
        existing.preferredChain,
        resolvedThreadId,
      ),
      resolvedThreadId,
      'created',
    );
  }

  async bootstrap(
    query: string,
    timeWindow: '24h' | '7d' = '24h',
    preferredChain: string | null = null,
    threadId: string | null = null,
  ): Promise<AnalyzeBootstrapResponse> {
    const requestId = randomUUID();
    const normalizedThreadId = this.normalizeOrCreateThreadId(threadId);
    const memo = normalizedThreadId
      ? this.intentMemo.get(normalizedThreadId)
      : null;
    await this.requestState.set({
      requestId,
      status: 'pending',
      threadId: normalizedThreadId,
      query,
      timeWindow,
      preferredChain,
      targets: [],
      candidates: [],
      payload: {
        query,
        timeWindow,
        memoUsed: Boolean(memo),
        threadId: normalizedThreadId,
        targets: [],
        phase: 'queued',
        label: '请求已受理',
        progressPct: 5,
        architecture: this.getModuleReadiness(),
        note:
          'Analyze job is queued and waiting for intent parsing and target resolution.',
      },
    });
    const queueMode = await this.enqueueAnalyzeJob({
      requestId,
      threadId: normalizedThreadId,
      query,
      timeWindow,
      preferredChain,
      targets: [],
    });
    this.emitProgressEvent(requestId, 'queued', 'pending', {
      queueMode,
      targetCount: 0,
    });

    return {
      status: 'accepted',
      requestId,
      nextAction: 'run_pipeline',
      message: 'Analyze job accepted and queued for preparation.',
      payload: {
        memoUsed: Boolean(memo),
        threadId: normalizedThreadId,
        targets: [],
        phase: 'queued',
        label: '请求已受理',
        progressPct: 5,
        queue: {
          mode: queueMode,
        },
        note:
          'Intent parsing and target resolution will run asynchronously before workflow execution.',
      },
    };
  }

  async select(
    requestId: string,
    candidateId: string,
    targetKey: string | null = null,
  ): Promise<AnalyzeSelectResponse> {
    const existing = await this.requestState.get(requestId);

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

    const candidateToResolve = targetToSelect.candidates.find(
      (candidate) => candidate.candidateId === candidateId,
    );
    const resolvedIdentity =
      candidateToResolve
        ? this.toIdentityFromCandidate(candidateToResolve)
        : this.searcher.resolveCandidateById(candidateId);
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
      await this.requestState.set(existing);

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
      await this.requestState.set(existing);
      return {
        status: 'failed',
        requestId,
        nextAction: 'invalid_selection',
        errorCode: 'INVALID_SELECTION',
        message: 'No resolved targets available for analysis.',
      };
    }

    await this.requestState.set(existing);
    const queueMode = await this.enqueueAnalyzeJob({
      requestId,
      threadId: existing.threadId,
      query: existing.query,
      timeWindow: existing.timeWindow,
      preferredChain: existing.preferredChain,
      targets: readyTargets,
      intentHint: existing.intentHint,
      intentMeta: existing.intentMeta,
    });
    await this.updateRequestProgress(existing, 'queued', 'pending', {
      note: 'Selection accepted. Analyze job is queued and waiting for worker execution.',
    });
    this.emitProgressEvent(requestId, 'queued', 'pending', {
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

  async getResult(requestId: string): Promise<AnalyzeResultResponse> {
    const existing = await this.requestState.get(requestId);

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
      this.fundamentals.getStatus(),
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

  getSearchCacheMetrics() {
    return this.searcher.getCacheMetrics();
  }

  private async runWorkflow(
    query: string,
    preferredChain: string | null,
    identity: AnalyzeIdentity,
    timeWindow: '24h' | '7d',
    intent: IntentOutput,
    intentMeta: WorkflowNodeExecutionMeta | undefined,
    onStageEvent?: (event: WorkflowStageEvent) => void,
  ) {
    return this.workflow.run(
      {
        query,
        preferredChain,
        identity,
        timeWindow,
        intent,
        intentMeta,
      },
      {
        onStageEvent,
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
    this.logger.debug(
      `processAnalyzeJob invoked (${data.requestId}) with ${data.targets.length} target(s).`,
    );

    const request = await this.requestState.get(data.requestId);
    if (!request) {
      this.logger.warn(
        `processAnalyzeJob skipped (${data.requestId}): request state not found.`,
      );
      return;
    }

    await this.updateRequestProgress(request, 'job_started', 'pending', {
      note:
        data.targets.length > 0
          ? '已收到用户确认，开始执行分析流程。'
          : '工作线程已接单，开始准备分析上下文。',
    });
    this.emitProgressEvent(data.requestId, 'job_started', 'pending', {
      queue: this.analyzeQueue.isQueueEnabled() ? 'bullmq' : 'inline_fallback',
      targetCount: data.targets.length,
      phase: data.targets.length > 0 ? 'workflow_execution' : 'preparation',
    });

    let executionData = data;

    try {
      const prepared = await this.prepareJobExecution(data, request);
      if (!prepared) {
        return;
      }

      executionData = prepared;
      const orchestrationIntent = executionData.intentHint as IntentOutput;
      const orchestrationIntentMeta = executionData.intentMeta;
      await this.updateRequestProgress(
        request,
        'intent_done',
        'pending',
        {
          note:
            executionData.targets.length > 0
              ? '问题已理解，准备开始规划分析步骤。'
              : '问题已理解，开始识别分析标的。',
        },
      );
      this.emitProgressEvent(
        executionData.requestId,
        'intent_done',
        'pending',
        {
          taskType: orchestrationIntent.taskType,
          entities: orchestrationIntent.entities,
          focusAreas: orchestrationIntent.focusAreas,
        },
      );
      await this.updateRequestProgress(
        request,
        'workflow_started',
        'pending',
        {
          note: '已完成准备，开始执行分析工作流。',
          targets: executionData.targets,
        },
      );
      this.emitProgressEvent(
        executionData.requestId,
        'workflow_started',
        'pending',
        {
          targetCount: executionData.targets.length,
          targetKeys: executionData.targets.map((target) => target.targetKey),
        },
      );

      const targetPipelines: TargetPipeline[] = await Promise.all(
        executionData.targets.map(async (target) => {
          const pipeline = await this.runWorkflow(
            executionData.query,
            executionData.preferredChain,
            target.identity,
            executionData.timeWindow,
            orchestrationIntent,
            orchestrationIntentMeta,
            (stageEvent) => {
              const streamEvent = this.stageEventToStreamEvent(stageEvent);
              void this.refreshRequestProgress(
                executionData.requestId,
                streamEvent,
                'pending',
                {
                  note: this.stageEventNote(stageEvent, target.identity.symbol),
                },
              );
              this.emitProgressEvent(
                executionData.requestId,
                streamEvent,
                'pending',
                {
                  stage: stageEvent.stage,
                  stageStatus: stageEvent.status,
                  stageTimestamp: stageEvent.timestamp,
                  targetKey: target.targetKey,
                  symbol: target.identity.symbol,
                  chain: target.identity.chain,
                },
              );
            },
          );

          return {
            targetKey: target.targetKey,
            identity: target.identity,
            pipeline,
          };
        }),
      );

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
        ? this.comparison.buildComparisonSummary(executionData.query, targetPipelines)
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

      const current = await this.requestState.get(executionData.requestId);
      if (!current) {
        this.logger.warn(
          `processAnalyzeJob cannot finalize (${executionData.requestId}): request state not found.`,
        );
        return;
      }

      current.status = 'ready';
      current.identity = primaryIdentity;
      current.payload = {
        ...current.payload,
        query: executionData.query,
        timeWindow: executionData.timeWindow,
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
          memoThreadId: executionData.threadId,
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
          nodeStatus: item.pipeline.nodeStatus,
        })),
        comparison,
        architecture: this.getModuleReadiness(),
        ...this.progressMeta('completed'),
        note:
          targetPipelines.length > 1 && shouldCompare
            ? 'Multi-target pipeline completed with intent-driven comparison.'
            : targetPipelines.length > 1
              ? 'Multi-target pipeline completed with per-token execution (no comparison requested).'
              : 'Pipeline completed by worker with LangGraph orchestration.',
      };

      if (executionData.threadId && executionData.threadId.trim().length > 0) {
        this.intentMemo.save({
          threadId: executionData.threadId,
          intent: orchestrationIntent,
          resolvedTargets: executionData.targets,
          requestId: executionData.requestId,
        });
      }
      await this.requestState.set(current);
      this.logger.debug(
        `processAnalyzeJob completed (${executionData.requestId}) with status=ready.`,
      );
      this.emitProgressEvent(executionData.requestId, 'completed', 'ready');
      this.requestState.completeEventStream(executionData.requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalizedError =
        error instanceof Error ? error : new Error(message);
      this.logger.error(
        `Analyze job failed (${executionData.requestId}).`,
        normalizedError,
      );
      const current = await this.requestState.get(executionData.requestId);
      if (!current) {
        return;
      }

      current.status = 'failed';
      current.payload = {
        ...current.payload,
        query: executionData.query,
        timeWindow: executionData.timeWindow,
        targets: executionData.targets,
        errorCode: 'WORKFLOW_EXECUTION_FAILED',
        errorMessage: message,
        architecture: this.getModuleReadiness(),
      };
      await this.requestState.set(current);
      this.emitProgressEvent(executionData.requestId, 'failed', 'failed', {
        errorMessage: message,
      });
      this.requestState.completeEventStream(executionData.requestId);
    }
  }

  private async prepareJobExecution(
    data: AnalyzeJobData,
    request: RequestState,
  ): Promise<AnalyzeJobData | null> {
    const memoForJob =
      data.threadId && data.threadId.trim().length > 0
        ? this.intentMemo.get(data.threadId)
        : null;
    if (!data.intentHint) {
      await this.updateRequestProgress(request, 'intent_started', 'pending', {
        note: '正在理解用户问题与分析目标。',
      });
      this.emitProgressEvent(data.requestId, 'intent_started', 'pending', {
        query: data.query,
        timeWindow: data.timeWindow,
        preferredChain: data.preferredChain,
      });
    }
    const intentResult =
      data.intentHint && data.intentMeta
        ? {
            intent: data.intentHint,
            meta: data.intentMeta,
          }
        : await this.workflow.parseIntentWithMeta({
            query: data.query,
            timeWindow: data.timeWindow,
            preferredChain: data.preferredChain,
            memo: memoForJob,
          });
    const intentHint = intentResult.intent;
    const intentMeta = intentResult.meta;

    request.intentHint = intentHint;
    request.intentMeta = intentMeta;

    if (data.targets.length > 0) {
      return {
        ...data,
        intentHint,
        intentMeta,
      };
    }

    await this.updateRequestProgress(request, 'target_resolution_started', 'pending', {
      note: '正在识别需要分析的标的。',
    });
    this.emitProgressEvent(
      data.requestId,
      'target_resolution_started',
      'pending',
      {
        query: data.query,
        objective: intentHint.objective,
        taskType: intentHint.taskType,
        entities: intentHint.entities,
        chains: intentHint.chains,
      },
    );
    const targetResults = await this.searcher.resolveMany(
      data.query,
      data.preferredChain,
      {
        objective: intentHint.objective,
        taskType: intentHint.taskType,
        entities: intentHint.entities,
        entityMentions: intentHint.entityMentions,
        chains: intentHint.chains,
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
    const readyTargets = this.getResolvedJobTargets(targets);

    await this.updateRequestProgress(request, 'target_resolution_done', 'pending', {
      note:
        pendingTargets.length > 0
          ? '已识别标的，等待用户确认。'
          : '已识别标的，准备进入分析流程。',
      targets,
      candidates: pendingCandidates,
    });
    this.emitProgressEvent(
      data.requestId,
      'target_resolution_done',
      'pending',
      {
        totalTargets: targets.length,
        resolvedCount: resolvedTargets.length,
        pendingSelectionCount: pendingTargets.length,
        notFoundCount: notFoundTargets.length,
        resolvedTargets: resolvedTargets.map((item) => ({
          targetKey: item.targetKey,
          identity: item.identity,
        })),
        pendingTargets: pendingTargets.map((item) => item.targetKey),
        notFoundTargets: notFoundTargets.map((item) => item.targetKey),
      },
    );

    request.targets = targets;
    request.candidates = pendingCandidates;
    request.identity = primaryIdentity;
    request.errorCode = undefined;

    if (resolvedTargets.length === 0 && pendingTargets.length === 0) {
      request.status = 'failed';
      request.errorCode = 'NOT_FOUND';
      request.payload = {
        query: data.query,
        timeWindow: data.timeWindow,
        errorCode: 'NOT_FOUND',
        intent: intentHint,
        nodeStatus: {
          intent: intentMeta,
        },
        memoUsed: Boolean(memoForJob),
        threadId: data.threadId,
        notFoundTargets: notFoundTargets.map((item) => item.targetKey),
        architecture: this.getModuleReadiness(),
        note: 'No matching token was found during asynchronous target resolution.',
      };
      await this.requestState.set(request);
      this.emitProgressEvent(data.requestId, 'failed', 'failed', {
        errorCode: 'NOT_FOUND',
        notFoundTargets: notFoundTargets.map((item) => item.targetKey),
      });
      this.requestState.completeEventStream(data.requestId);
      return null;
    }

    if (targets.length > 1 && notFoundTargets.length > 0) {
      request.status = 'failed';
      request.errorCode = 'NOT_FOUND';
      request.payload = {
        query: data.query,
        timeWindow: data.timeWindow,
        errorCode: 'NOT_FOUND',
        intent: intentHint,
        nodeStatus: {
          intent: intentMeta,
        },
        memoUsed: Boolean(memoForJob),
        threadId: data.threadId,
        notFoundTargets: notFoundTargets.map((item) => item.targetKey),
        resolvedTargets: resolvedTargets.map((item) => ({
          targetKey: item.targetKey,
          identity: item.identity,
        })),
        architecture: this.getModuleReadiness(),
        note: 'Some comparison targets could not be resolved during asynchronous preparation.',
      };
      await this.requestState.set(request);
      this.emitProgressEvent(data.requestId, 'failed', 'failed', {
        errorCode: 'NOT_FOUND',
        notFoundTargets: notFoundTargets.map((item) => item.targetKey),
      });
      this.requestState.completeEventStream(data.requestId);
      return null;
    }

    if (pendingTargets.length > 0) {
      request.status = 'waiting_selection';
      request.payload = {
        query: data.query,
        timeWindow: data.timeWindow,
        intent: intentHint,
        nodeStatus: {
          intent: intentMeta,
        },
        memoUsed: Boolean(memoForJob),
        threadId: data.threadId,
        identity: primaryIdentity,
        targets: readyTargets,
        pendingTargets: pendingTargets.map((item) => item.targetKey),
        resolvedTargets: resolvedTargets.map((item) => ({
          targetKey: item.targetKey,
          identity: item.identity,
        })),
        architecture: this.getModuleReadiness(),
        note:
          'Candidate selection is required before queueing workflow execution.',
      };
      await this.requestState.set(request);
      this.emitProgressEvent(
        data.requestId,
        'selection_required',
        'waiting_selection',
        {
          ...this.requestSnapshotData(request),
          candidates: pendingCandidates,
        },
      );
      return null;
    }

    request.status = 'pending';
    request.payload = {
      query: data.query,
      timeWindow: data.timeWindow,
      intent: intentHint,
      nodeStatus: {
        intent: intentMeta,
      },
      memoUsed: Boolean(memoForJob),
      threadId: data.threadId,
      identity: primaryIdentity,
      targets: readyTargets,
      phase: 'workflow_execution',
      label: '开始分析',
      progressPct: 55,
      architecture: this.getModuleReadiness(),
      note:
        'Intent parsed and targets resolved. Workflow execution is starting.',
    };
    await this.requestState.set(request);

    return {
      ...data,
      targets: readyTargets,
      intentHint,
      intentMeta,
    };
  }

  private stageEventToStreamEvent(
    event: WorkflowStageEvent,
  ): AnalyzeStreamEventName {
    if (event.stage === 'intent') {
      return 'intent_done';
    }

    const mapping: Record<
      Exclude<WorkflowStageEvent['stage'], 'intent'>,
      Record<WorkflowStageEvent['status'], AnalyzeStreamEventName>
    > = {
      planning: {
        started: 'planning_started',
        completed: 'planning_done',
      },
      executor: {
        started: 'executor_started',
        completed: 'executor_done',
      },
      risk_strategy: {
        started: 'risk_strategy_started',
        completed: 'risk_strategy_done',
      },
      analysis: {
        started: 'analysis_started',
        completed: 'analysis_done',
      },
      report: {
        started: 'report_started',
        completed: 'report_done',
      },
    };

    return mapping[event.stage][event.status];
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

  private toSubmitResponse(
    response: AnalyzeBootstrapResponse | AnalyzeSelectResponse,
    threadId: string | null,
    mode: 'created' | 'continued',
  ): AnalyzeSubmitResponse {
    if (response.status === 'failed') {
      const errorCode =
        'errorCode' in response &&
        response.errorCode &&
        response.errorCode !== 'NOT_FOUND'
          ? response.errorCode
          : undefined;
      const payload = 'payload' in response ? response.payload : undefined;
      const nextAction =
        'nextAction' in response && response.nextAction === 'invalid_selection'
          ? 'clarify_input'
          : 'request_not_found';
      return {
        status: 'failed',
        requestId: response.requestId,
        threadId,
        mode,
        nextAction,
        errorCode,
        message: response.message,
        payload,
      };
    }

    return {
      status: 'accepted',
      requestId: response.requestId,
      threadId,
      mode,
      nextAction:
        response.nextAction === 'selection_recorded'
          ? 'selection_recorded'
          : 'run_pipeline',
      message: response.message,
      payload: response.payload,
    };
  }

  private resolveSelectionReply(
    request: RequestState,
    message: string,
  ):
    | { kind: 'matched'; candidateId: string; targetKey: string | null }
    | { kind: 'clarify' }
    | { kind: 'new_query' } {
    const pendingTargets = request.targets.filter(
      (target) => target.status === 'waiting_selection',
    );
    if (pendingTargets.length === 0) {
      return { kind: 'new_query' };
    }

    const ordinal = this.parseOrdinalSelection(message);
    if (ordinal !== null && pendingTargets.length === 1) {
      const candidate = pendingTargets[0].candidates[ordinal];
      if (candidate) {
        return {
          kind: 'matched',
          candidateId: candidate.candidateId,
          targetKey: pendingTargets[0].targetKey,
        };
      }
      return { kind: 'clarify' };
    }

    const normalizedMessage = this.normalizeFreeText(message);
    const scoredMatches = pendingTargets
      .flatMap((target) =>
        target.candidates.map((candidate) => ({
          candidate,
          targetKey: target.targetKey,
          score: this.scoreCandidateReply(normalizedMessage, candidate),
        })),
      )
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    if (scoredMatches.length === 0) {
      return this.looksLikeSelectionReply(message)
        ? { kind: 'clarify' }
        : { kind: 'new_query' };
    }

    const [best, second] = scoredMatches;
    if (second && second.score === best.score) {
      return { kind: 'clarify' };
    }

    return {
      kind: 'matched',
      candidateId: best.candidate.candidateId,
      targetKey: best.targetKey,
    };
  }

  private scoreCandidateReply(
    normalizedMessage: string,
    candidate: AnalyzeCandidate,
  ): number {
    const fields = [
      candidate.symbol,
      candidate.tokenName,
      candidate.chain,
      candidate.candidateId,
      candidate.tokenAddress,
    ]
      .map((value) => this.normalizeFreeText(value))
      .filter((value) => value.length > 0);

    let score = 0;
    for (const field of fields) {
      if (normalizedMessage === field) {
        score = Math.max(score, 100);
        continue;
      }
      if (field.length >= 3 && normalizedMessage.includes(field)) {
        score = Math.max(score, 80);
      }
    }

    const symbol = this.normalizeFreeText(candidate.symbol);
    if (symbol && normalizedMessage.split(' ').includes(symbol)) {
      score = Math.max(score, 95);
    }

    return score;
  }

  private parseOrdinalSelection(message: string): number | null {
    const normalized = message.trim().toLowerCase();
    const mapping: Array<[RegExp, number]> = [
      [/(^|\s)(1|first|one)(\s|$)/, 0],
      [/第\s*一|第1|第一个/, 0],
      [/(^|\s)(2|second|two)(\s|$)/, 1],
      [/第\s*二|第2|第二个/, 1],
      [/(^|\s)(3|third|three)(\s|$)/, 2],
      [/第\s*三|第3|第三个/, 2],
    ];
    for (const [pattern, index] of mapping) {
      if (pattern.test(normalized)) {
        return index;
      }
    }
    return null;
  }

  private looksLikeSelectionReply(message: string): boolean {
    return /(选|选择|pick|choose|first|second|third|第\s*[一二三123])/.test(
      message.toLowerCase(),
    );
  }

  private normalizeFreeText(value: string | null | undefined): string {
    return (value ?? '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeOrCreateThreadId(threadId: string | null | undefined): string {
    const normalized = threadId?.trim();
    if (normalized) {
      return normalized;
    }
    return randomUUID();
  }

  private toIdentityFromCandidate(candidate: AnalyzeCandidate): AnalyzeIdentity {
    return {
      symbol: candidate.symbol,
      chain: candidate.chain,
      tokenAddress: candidate.tokenAddress,
      sourceId: candidate.sourceId,
    };
  }

  private getResolvedJobTargets(targets: RequestTarget[]): AnalyzeJobTarget[] {
    return targets
      .filter((target) => target.status === 'resolved' && target.identity)
      .map((target) => ({
        targetKey: target.targetKey,
        identity: target.identity as AnalyzeIdentity,
      }));
  }

  private requestSnapshotData(request: RequestState): Record<string, unknown> {
    return {
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
      candidates: request.candidates,
    };
  }

  private emitProgressEvent(
    requestId: string,
    event: AnalyzeStreamEventName,
    status: RequestState['status'],
    data?: Record<string, unknown>,
  ): void {
    this.requestState.emitEvent(requestId, event, status, {
      ...this.progressMeta(event),
      ...data,
    });
  }

  private async updateRequestProgress(
    request: RequestState,
    event: AnalyzeStreamEventName,
    status: RequestState['status'],
    extra?: Record<string, unknown>,
  ): Promise<void> {
    request.status = status;
    request.payload = {
      ...request.payload,
      ...this.progressMeta(event),
      ...extra,
    };
    await this.requestState.set(request);
  }

  private async refreshRequestProgress(
    requestId: string,
    event: AnalyzeStreamEventName,
    status: RequestState['status'],
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const request = await this.requestState.get(requestId);
    if (!request) {
      return;
    }
    request.payload = {
      ...request.payload,
      ...this.progressMeta(event),
      ...extra,
    };
    await this.requestState.set(request);
  }

  private progressMeta(event: AnalyzeStreamEventName): Record<string, unknown> {
    const mapping: Record<
      AnalyzeStreamEventName,
      { phase: string; label: string; progressPct: number }
    > = {
      snapshot: {
        phase: 'snapshot',
        label: '状态快照',
        progressPct: 0,
      },
      queued: {
        phase: 'queued',
        label: '请求已受理',
        progressPct: 5,
      },
      job_started: {
        phase: 'preparation',
        label: '开始准备',
        progressPct: 10,
      },
      intent_started: {
        phase: 'intent',
        label: '理解问题',
        progressPct: 15,
      },
      intent_done: {
        phase: 'intent',
        label: '问题理解完成',
        progressPct: 25,
      },
      target_resolution_started: {
        phase: 'target_resolution',
        label: '识别标的',
        progressPct: 35,
      },
      target_resolution_done: {
        phase: 'target_resolution',
        label: '标的识别完成',
        progressPct: 45,
      },
      selection_required: {
        phase: 'waiting_selection',
        label: '等待确认标的',
        progressPct: 50,
      },
      workflow_started: {
        phase: 'workflow_execution',
        label: '开始分析',
        progressPct: 55,
      },
      planning_started: {
        phase: 'planning',
        label: '开始制定分析计划',
        progressPct: 60,
      },
      planning_done: {
        phase: 'planning',
        label: '分析计划完成',
        progressPct: 65,
      },
      executor_started: {
        phase: 'data_collection',
        label: '开始采集数据',
        progressPct: 70,
      },
      executor_done: {
        phase: 'data_collection',
        label: '数据采集完成',
        progressPct: 78,
      },
      risk_strategy_started: {
        phase: 'risk_strategy',
        label: '开始判断风险与策略',
        progressPct: 82,
      },
      risk_strategy_done: {
        phase: 'risk_strategy',
        label: '风险与策略判断完成',
        progressPct: 85,
      },
      analysis_started: {
        phase: 'analysis',
        label: '开始综合分析',
        progressPct: 88,
      },
      analysis_done: {
        phase: 'analysis',
        label: '综合分析完成',
        progressPct: 92,
      },
      report_started: {
        phase: 'report',
        label: '开始生成报告',
        progressPct: 95,
      },
      report_done: {
        phase: 'report',
        label: '报告生成完成',
        progressPct: 97,
      },
      completed: {
        phase: 'completed',
        label: '分析完成',
        progressPct: 100,
      },
      failed: {
        phase: 'failed',
        label: '分析失败',
        progressPct: 100,
      },
    };
    return mapping[event];
  }

  private stageEventNote(
    event: WorkflowStageEvent,
    symbol: string,
  ): string {
    const targetLabel = symbol.trim() ? `${symbol} ` : '';
    if (event.stage === 'planning' && event.status === 'started') {
      return `正在为 ${targetLabel}制定分析计划。`.trim();
    }
    if (event.stage === 'planning' && event.status === 'completed') {
      return `${targetLabel}分析计划已完成。`.trim();
    }
    if (event.stage === 'executor' && event.status === 'started') {
      return `正在为 ${targetLabel}采集和整理数据。`.trim();
    }
    if (event.stage === 'executor' && event.status === 'completed') {
      return `${targetLabel}数据采集已完成。`.trim();
    }
    if (event.stage === 'risk_strategy' && event.status === 'started') {
      return `正在为 ${targetLabel}判断风险和策略。`.trim();
    }
    if (event.stage === 'risk_strategy' && event.status === 'completed') {
      return `${targetLabel}风险与策略判断已完成。`.trim();
    }
    if (event.stage === 'analysis' && event.status === 'started') {
      return `正在为 ${targetLabel}生成综合分析。`.trim();
    }
    if (event.stage === 'analysis' && event.status === 'completed') {
      return `${targetLabel}综合分析已完成。`.trim();
    }
    if (event.stage === 'report' && event.status === 'started') {
      return `正在为 ${targetLabel}整理分析报告。`.trim();
    }
    if (event.stage === 'report' && event.status === 'completed') {
      return `${targetLabel}分析报告已生成。`.trim();
    }
    return `正在处理 ${targetLabel}分析阶段。`.trim();
  }

  async onModuleDestroy(): Promise<void> {
    await this.analyzeQueue.shutdown();
    this.requestState.completeAllEventStreams();
  }
}

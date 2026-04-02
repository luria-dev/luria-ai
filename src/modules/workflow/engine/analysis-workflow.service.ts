import { Injectable } from '@nestjs/common';
import type {
  AlertsSnapshot,
  AnalyzeIdentity,
  ModuleReadiness,
  StrategySnapshot,
} from '../../../data/contracts/analyze-contracts';
import {
  AnalysisOutput,
  IntentMemoSnapshot,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
  ReportOutput,
  WorkflowNodeExecutionMeta,
  WorkflowNodeStatus,
  WorkflowRunResult,
} from '../../../data/contracts/workflow-contracts';
import { AlertsService } from '../../risk/alerts/alerts.service';
import { IntentNodeService } from '../nodes/intent-node.service';
import { PlanningNodeService } from '../nodes/planning-node.service';
import { DataExecutorNodeService } from '../nodes/data-executor-node.service';
import { AnalysisNodeService } from '../nodes/analysis-node.service';
import { ReportNodeService } from '../nodes/report-node.service';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

type RunWorkflowInput = {
  query: string;
  timeWindow: '24h' | '7d' | '30d';
  preferredChain: string | null;
  identity: AnalyzeIdentity;
  intent: IntentOutput;
  intentMeta?: WorkflowNodeExecutionMeta;
  renderPerTargetReport?: boolean;
  conversationHistoryRaw?: string | null;
};

export type WorkflowStage =
  | 'intent'
  | 'planning'
  | 'executor'
  | 'risk_strategy'
  | 'analysis'
  | 'report';

export type WorkflowStageStatus = 'started' | 'completed';

export type WorkflowStageEvent = {
  stage: WorkflowStage;
  status: WorkflowStageStatus;
  timestamp: string;
  data?: Record<string, unknown>;
};

type WorkflowRunOptions = {
  onStageEvent?: (event: WorkflowStageEvent) => void;
};

const WorkflowStateAnnotation = Annotation.Root({
  query: Annotation<string>(),
  timeWindow: Annotation<'24h' | '7d' | '30d'>(),
  preferredChain: Annotation<string | null>(),
  identity: Annotation<AnalyzeIdentity>(),
  conversationHistoryRaw: Annotation<string | null>(),
  onStageEvent: Annotation<((event: WorkflowStageEvent) => void) | undefined>(),
  intent: Annotation<IntentOutput>(),
  plan: Annotation<PlanOutput>(),
  execution: Annotation<ExecutionOutput>(),
  alerts: Annotation<AlertsSnapshot>(),
  strategy: Annotation<StrategySnapshot>(),
  analysis: Annotation<AnalysisOutput>(),
  report: Annotation<ReportOutput>(),
  renderPerTargetReport: Annotation<boolean>(),
  nodeStatus: Annotation<WorkflowNodeStatus>(),
});

type WorkflowGraphState = typeof WorkflowStateAnnotation.State;

@Injectable()
export class AnalysisWorkflowService {
  readonly moduleName = 'workflow';
  private readonly workflowGraph;

  constructor(
    private readonly intentNode: IntentNodeService,
    private readonly planningNode: PlanningNodeService,
    private readonly dataExecutorNode: DataExecutorNodeService,
    private readonly alerts: AlertsService,
    private readonly analysisNode: AnalysisNodeService,
    private readonly reportNode: ReportNodeService,
  ) {
    this.workflowGraph = this.buildGraph();
  }

  getStatus(): ModuleReadiness {
    return { module: this.moduleName, state: 'skeleton_ready' };
  }

  async parseIntent(input: {
    query: string;
    timeWindow: '24h' | '7d' | '30d';
    preferredChain: string | null;
    language?: IntentOutput['language'];
    memo?: IntentMemoSnapshot | null;
  }): Promise<IntentOutput> {
    const result = await this.parseIntentWithMeta(input);
    return result.intent;
  }

  async parseIntentWithMeta(input: {
    query: string;
    timeWindow: '24h' | '7d' | '30d';
    preferredChain: string | null;
    language?: IntentOutput['language'];
    memo?: IntentMemoSnapshot | null;
  }): Promise<{
    intent: IntentOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    return this.intentNode.parseWithMeta(input);
  }

  async run(
    input: RunWorkflowInput,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRunResult> {
    const state = (await this.workflowGraph.invoke({
      query: input.query,
      timeWindow: input.timeWindow,
      preferredChain: input.preferredChain,
      identity: input.identity,
      conversationHistoryRaw: input.conversationHistoryRaw ?? null,
      intent: input.intent,
      renderPerTargetReport: input.renderPerTargetReport ?? true,
      nodeStatus: input.intentMeta
        ? {
            intent: input.intentMeta,
          }
        : undefined,
      onStageEvent: options?.onStageEvent,
    })) as WorkflowGraphState;

    const intent = this.requireField(
      state.intent as IntentOutput | undefined,
      'intent',
    );
    const plan = this.requireField(
      state.plan as PlanOutput | undefined,
      'plan',
    );
    const execution = this.requireField(
      state.execution as ExecutionOutput | undefined,
      'execution',
    );
    const alerts = this.requireField(
      state.alerts as AlertsSnapshot | undefined,
      'alerts',
    );
    const strategy = this.requireField(
      state.strategy as StrategySnapshot | undefined,
      'strategy',
    );
    const analysis = this.requireField(
      state.analysis as AnalysisOutput | undefined,
      'analysis',
    );
    const report = this.requireField(
      state.report as ReportOutput | undefined,
      'report',
    );
    const nodeStatus =
      (state.nodeStatus as WorkflowNodeStatus | undefined) ?? {};

    return {
      ...execution.data,
      intent,
      plan,
      execution,
      alerts,
      strategy,
      analysis,
      report,
      nodeStatus,
    };
  }

  private buildGraph() {
    return new StateGraph(WorkflowStateAnnotation)
      .addNode('n_planning', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'planning', 'started');
        const intent = this.requireField(
          state.intent as IntentOutput | undefined,
          'intent',
        );
        const planResult = await this.planningNode.buildWithMeta({
          intent,
          identity: state.identity,
        });
        this.emitStageEvent(state, 'planning', 'completed');
        return {
          plan: planResult.plan,
          nodeStatus: {
            ...((state.nodeStatus as WorkflowNodeStatus | undefined) ?? {}),
            planning: planResult.meta,
          },
        };
      })
      .addNode('n_direct_response', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'report', 'started');
        const intent = this.requireField(
          state.intent as IntentOutput | undefined,
          'intent',
        );
        const plan = this.requireField(
          state.plan as PlanOutput | undefined,
          'plan',
        );
        const execution = this.buildPlaceholderExecution(state.identity);
        const alerts = this.buildPlaceholderAlerts();
        const analysis = this.buildPlaceholderAnalysis(plan, intent);
        const strategy = this.analysisNode.toStrategySnapshot(analysis);
        const report = this.reportNode.buildTaskDispositionOnly({
          intent,
          plan,
          symbol: state.identity.symbol,
        });
        this.emitStageEvent(state, 'report', 'completed');
        return {
          execution,
          alerts,
          analysis,
          strategy,
          report,
          nodeStatus: {
            ...((state.nodeStatus as WorkflowNodeStatus | undefined) ?? {}),
            executor: {
              llmStatus: 'skipped',
              attempts: 0,
              schemaCorrection: false,
              failureReason: `task_disposition_${plan.taskDisposition}`,
              model: null,
            },
            analysis: {
              llmStatus: 'skipped',
              attempts: 0,
              schemaCorrection: false,
              failureReason: `task_disposition_${plan.taskDisposition}`,
              model: null,
            },
            report: {
              llmStatus: 'skipped',
              attempts: 0,
              schemaCorrection: false,
              failureReason: `task_disposition_${plan.taskDisposition}`,
              model: null,
            },
          },
        };
      })
      .addNode('n_executor', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'executor', 'started');
        const intent = this.requireField(
          state.intent as IntentOutput | undefined,
          'intent',
        );
        const plan = this.requireField(
          state.plan as PlanOutput | undefined,
          'plan',
        );
        const execution = await this.dataExecutorNode.execute({
          query: state.query,
          plan,
          identity: state.identity,
          timeWindow: state.timeWindow,
          objective: intent.objective,
          taskType: intent.taskType,
        });
        this.emitStageEvent(state, 'executor', 'completed', {
          dataSummaryPoints: this.buildExecutionSummary(execution),
        });
        return { execution };
      })
      .addNode('n_risk_strategy', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'risk_strategy', 'started');
        const execution = this.requireField(
          state.execution as ExecutionOutput | undefined,
          'execution',
        );
        const alerts = this.alerts.buildSnapshot({
          price: execution.data.market.price,
          onchain: execution.data.onchain.cexNetflow,
          security: execution.data.security,
          liquidity: execution.data.liquidity,
          tokenomics: execution.data.tokenomics,
        });
        this.emitStageEvent(state, 'risk_strategy', 'completed', {
          riskSummaryPoints: this.buildAlertsSummary(alerts),
        });
        return { alerts };
      })
      .addNode('n_analysis', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'analysis', 'started');
        const intent = this.requireField(
          state.intent as IntentOutput | undefined,
          'intent',
        );
        const plan = this.requireField(
          state.plan as PlanOutput | undefined,
          'plan',
        );
        const execution = this.requireField(
          state.execution as ExecutionOutput | undefined,
          'execution',
        );
        const alerts = this.requireField(
          state.alerts as AlertsSnapshot | undefined,
          'alerts',
        );
        const analysisResult = await this.analysisNode.analyzeWithMeta({
          intent,
          plan,
          execution,
          alerts,
        });
        const strategy = this.analysisNode.toStrategySnapshot(
          analysisResult.analysis,
        );
        this.emitStageEvent(state, 'analysis', 'completed');
        return {
          analysis: analysisResult.analysis,
          strategy,
          nodeStatus: {
            ...((state.nodeStatus as WorkflowNodeStatus | undefined) ?? {}),
            analysis: analysisResult.meta,
          },
        };
      })
      .addNode('n_report', async (state: WorkflowGraphState) => {
        this.emitStageEvent(state, 'report', 'started');
        const intent = this.requireField(
          state.intent as IntentOutput | undefined,
          'intent',
        );
        const execution = this.requireField(
          state.execution as ExecutionOutput | undefined,
          'execution',
        );
        const plan = this.requireField(
          state.plan as PlanOutput | undefined,
          'plan',
        );
        const analysis = this.requireField(
          state.analysis as AnalysisOutput | undefined,
          'analysis',
        );
        const alerts = this.requireField(
          state.alerts as AlertsSnapshot | undefined,
          'alerts',
        );
        const renderPerTargetReport =
          (state.renderPerTargetReport as boolean | undefined) ?? true;
        if (!renderPerTargetReport) {
          this.emitStageEvent(state, 'report', 'completed');
          return {
            report: this.reportNode.buildDeterministicOnly({
              intent,
              plan,
              execution,
              analysis,
              alerts,
              conversationHistoryRaw:
                (state.conversationHistoryRaw as string | null | undefined) ??
                null,
            }),
            nodeStatus: {
              ...((state.nodeStatus as WorkflowNodeStatus | undefined) ?? {}),
              report: {
                llmStatus: 'skipped',
                attempts: 0,
                schemaCorrection: false,
                failureReason: 'comparison_mode_skip',
                model: null,
              },
            },
          };
        }
        const reportResult = await this.reportNode.renderWithMeta({
          intent,
          plan,
          execution,
          analysis,
          alerts,
          conversationHistoryRaw:
            (state.conversationHistoryRaw as string | null | undefined) ?? null,
        });
        this.emitStageEvent(state, 'report', 'completed');
        return {
          report: reportResult.report,
          nodeStatus: {
            ...((state.nodeStatus as WorkflowNodeStatus | undefined) ?? {}),
            report: reportResult.meta,
          },
        };
      })
      .addEdge(START, 'n_planning')
      .addConditionalEdges('n_planning', (state: WorkflowGraphState) => {
        const plan = state.plan as PlanOutput | undefined;
        return plan?.taskDisposition === 'analyze'
          ? 'n_executor'
          : 'n_direct_response';
      })
      .addEdge('n_executor', 'n_risk_strategy')
      .addEdge('n_risk_strategy', 'n_analysis')
      .addEdge('n_analysis', 'n_report')
      .addEdge('n_direct_response', END)
      .addEdge('n_report', END)
      .compile();
  }

  private buildPlaceholderExecution(identity: AnalyzeIdentity): ExecutionOutput {
    const asOf = new Date().toISOString();
    return {
      identity,
      requestedTypes: [],
      executedTypes: [],
      collectedTypes: [],
      degradedNodes: [],
      missingEvidence: [],
      routing: [],
      asOf,
      data: {
        market: {
          price: {
            priceUsd: null,
            change1hPct: null,
            change24hPct: null,
            change7dPct: null,
            change30dPct: null,
            marketCapRank: null,
            circulatingSupply: null,
            totalSupply: null,
            maxSupply: null,
            fdvUsd: null,
            totalVolume24hUsd: null,
            athUsd: null,
            atlUsd: null,
            athChangePct: null,
            atlChangePct: null,
            asOf,
            sourceUsed: 'market_unavailable',
            degraded: true,
            degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
          },
        },
        news: {
          items: [],
          asOf,
          sourceUsed: 'news_unavailable',
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        openResearch: {
          enabled: false,
          query: '',
          topics: [],
          goals: [],
          preferredSources: [],
          takeaways: [],
          items: [],
          asOf,
          sourceUsed: [],
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        tokenomics: {
          allocation: {
            teamPct: null,
            investorPct: null,
            communityPct: null,
            foundationPct: null,
          },
          vestingSchedule: [],
          inflationRate: {
            currentAnnualPct: null,
            targetAnnualPct: null,
            isDynamic: false,
          },
          burns: {
            totalBurnAmount: null,
            recentBurns: [],
          },
          buybacks: {
            totalBuybackAmount: null,
            recentBuybacks: [],
          },
          fundraising: {
            totalRaised: null,
            rounds: [],
          },
          evidence: [],
          evidenceConflicts: [],
          asOf,
          sourceUsed: [],
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
          tokenomicsEvidenceInsufficient: true,
        },
        fundamentals: {
          profile: {
            projectId: null,
            name: identity.symbol,
            tokenSymbol: identity.symbol,
            oneLiner: null,
            description: null,
            establishmentDate: null,
            active: null,
            logoUrl: null,
            rootdataUrl: null,
            tags: [],
            totalFundingUsd: null,
            rtScore: null,
            tvlScore: null,
            similarProjects: [],
          },
          team: [],
          investors: [],
          fundraising: [],
          ecosystems: {
            ecosystems: [],
            onMainNet: [],
            onTestNet: [],
            planToLaunch: [],
          },
          social: {
            heat: null,
            heatRank: null,
            influence: null,
            influenceRank: null,
            followers: null,
            following: null,
            hotIndexScore: null,
            hotIndexRank: null,
            xHeatScore: null,
            xHeatRank: null,
            xInfluenceScore: null,
            xInfluenceRank: null,
            xFollowersScore: null,
            xFollowersRank: null,
            socialLinks: [],
          },
          asOf,
          sourceUsed: [],
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        technical: {
          rsi: { period: 14, value: null, signal: 'neutral' },
          macd: {
            macd: null,
            signalLine: null,
            histogram: null,
            signal: 'neutral',
          },
          ma: { ma7: null, ma25: null, ma99: null, signal: 'neutral' },
          boll: {
            upper: null,
            middle: null,
            lower: null,
            bandwidth: null,
            signal: 'neutral',
          },
          atr: { value: null, period: 14 },
          swingHigh: null,
          swingLow: null,
          summarySignal: 'neutral',
          asOf,
          sourceUsed: 'technical_unavailable',
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        onchain: {
          cexNetflow: {
            window: '30d',
            inflowUsd: null,
            outflowUsd: null,
            netflowUsd: null,
            signal: 'neutral',
            exchanges: [],
            asOf,
            sourceUsed: [],
            degraded: true,
            degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
          },
        },
        security: {
          isContractOpenSource: null,
          isHoneypot: null,
          isOwnerRenounced: null,
          riskScore: null,
          riskLevel: 'unknown',
          riskItems: [],
          canTradeSafely: null,
          holderCount: null,
          lpHolderCount: null,
          creatorPercent: null,
          ownerPercent: null,
          isInCex: null,
          cexList: [],
          isInDex: null,
          transferPausable: null,
          selfdestruct: null,
          externalCall: null,
          honeypotWithSameCreator: null,
          trustList: null,
          isAntiWhale: null,
          transferTax: null,
          asOf,
          sourceUsed: 'security_unavailable',
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        liquidity: {
          quoteToken: 'OTHER',
          hasUsdtOrUsdcPair: false,
          liquidityUsd: null,
          liquidity1hAgoUsd: null,
          liquidityDrop1hPct: null,
          withdrawalRiskFlag: false,
          volume24hUsd: null,
          priceImpact1kPct: null,
          isLpLocked: null,
          lpLockRatioPct: null,
          rugpullRiskSignal: 'unknown',
          warnings: [],
          asOf,
          sourceUsed: 'liquidity_unavailable',
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
        sentiment: {
          socialVolume: null,
          socialDominance: null,
          sentimentPositive: null,
          sentimentNegative: null,
          sentimentBalanced: null,
          sentimentScore: null,
          devActivity: null,
          githubActivity: null,
          signal: 'neutral',
          asOf,
          sourceUsed: 'sentiment_unavailable',
          degraded: true,
          degradeReason: 'TASK_DISPOSITION_SHORT_CIRCUIT',
        },
      },
    };
  }

  private buildPlaceholderAlerts(): AlertsSnapshot {
    return {
      alertLevel: 'info',
      alertType: [],
      riskState: 'normal',
      redCount: 0,
      yellowCount: 0,
      items: [],
      asOf: new Date().toISOString(),
    };
  }

  private buildPlaceholderAnalysis(
    plan: PlanOutput,
    intent: IntentOutput,
  ): AnalysisOutput {
    const isZh = intent.language === 'zh' || intent.language === 'cn';
    const reason =
      plan.taskDisposition === 'clarify'
        ? isZh
          ? '进入分析前需要先澄清用户真实任务。'
          : 'The user request needs clarification before analysis.'
        : plan.taskDisposition === 'non_analysis'
          ? isZh
            ? '该请求不适合进入标准币种分析流程。'
            : 'This request should not enter the standard asset analysis flow.'
          : isZh
            ? '该请求不适合继续作为常规分析任务处理。'
            : 'This request should not continue as a normal analysis task.';

    return {
      verdict: 'INSUFFICIENT_DATA',
      confidence: 0,
      reason,
      buyZone: null,
      sellZone: null,
      evidence: [reason],
      summary: reason,
      keyObservations: [plan.primaryIntent],
      hardBlocks: [],
      riskHighlights: [],
      opportunityHighlights: [],
      dataQualityNotes: [],
    };
  }

  private emitStageEvent(
    state: WorkflowGraphState,
    stage: WorkflowStage,
    status: WorkflowStageStatus,
    data?: Record<string, unknown>,
  ): void {
    const callback = state.onStageEvent as
      | ((event: WorkflowStageEvent) => void)
      | undefined;
    callback?.({
      stage,
      status,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  private buildExecutionSummary(execution: ExecutionOutput): string[] {
    const price = execution.data.market.price;
    const technical = execution.data.technical;
    const sentiment = execution.data.sentiment;
    const liquidity = execution.data.liquidity;

    const points: string[] = [];
    if (price.priceUsd != null) {
      points.push(`现价 ${this.formatUsd(price.priceUsd)}`);
    }
    if (price.change24hPct != null) {
      points.push(`24h ${this.formatPct(price.change24hPct)}`);
    }
    if (technical.summarySignal) {
      points.push(`技术面 ${technical.summarySignal}`);
    }
    if (sentiment.signal) {
      points.push(`情绪 ${sentiment.signal}`);
    }
    if (liquidity.liquidityUsd != null) {
      points.push(`流动性 ${this.formatCompactUsd(liquidity.liquidityUsd)}`);
    }
    // 降级数据不展示给用户，只记录在后端日志
    if (execution.missingEvidence.length > 0) {
      points.push(`缺失证据: ${execution.missingEvidence.join(', ')}`);
    }
    return points;
  }

  private buildAlertsSummary(alerts: AlertsSnapshot): string[] {
    const points: string[] = [
      `风险等级 ${alerts.alertLevel}`,
      `风险状态 ${alerts.riskState}`,
    ];
    if (alerts.redCount > 0 || alerts.yellowCount > 0) {
      points.push(`红色 ${alerts.redCount} / 黄色 ${alerts.yellowCount}`);
    }
    for (const item of alerts.items.slice(0, 3)) {
      points.push(item.message);
    }
    return points;
  }

  private formatUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  }

  private formatCompactUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }

  private formatPct(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  private requireField<T>(value: T | undefined, field: string): T {
    if (value === undefined) {
      throw new Error(`Workflow state missing required field: ${field}`);
    }
    return value;
  }
}

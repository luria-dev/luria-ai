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
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  identity: AnalyzeIdentity;
  intent: IntentOutput;
  intentMeta?: WorkflowNodeExecutionMeta;
  renderPerTargetReport?: boolean;
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
  timeWindow: Annotation<'24h' | '7d'>(),
  preferredChain: Annotation<string | null>(),
  identity: Annotation<AnalyzeIdentity>(),
  onStageEvent: Annotation<
    ((event: WorkflowStageEvent) => void) | undefined
  >(),
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
    timeWindow: '24h' | '7d';
    preferredChain: string | null;
    language?: IntentOutput['language'];
    memo?: IntentMemoSnapshot | null;
  }): Promise<IntentOutput> {
    const result = await this.parseIntentWithMeta(input);
    return result.intent;
  }

  async parseIntentWithMeta(input: {
    query: string;
    timeWindow: '24h' | '7d';
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
    const nodeStatus = (state.nodeStatus as WorkflowNodeStatus | undefined) ?? {};

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
              execution,
              analysis,
              alerts,
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
          execution,
          analysis,
          alerts,
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
      .addEdge('n_planning', 'n_executor')
      .addEdge('n_executor', 'n_risk_strategy')
      .addEdge('n_risk_strategy', 'n_analysis')
      .addEdge('n_analysis', 'n_report')
      .addEdge('n_report', END)
      .compile();
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

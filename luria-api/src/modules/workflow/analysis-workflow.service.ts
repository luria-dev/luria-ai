import { Injectable } from '@nestjs/common';
import type {
  AlertsSnapshot,
  AnalyzeIdentity,
  ModuleReadiness,
  StrategySnapshot,
} from '../../core/contracts/analyze-contracts';
import {
  AnalysisOutput,
  IntentMemoSnapshot,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
  ReportOutput,
  WorkflowRunResult,
} from '../../core/contracts/workflow-contracts';
import { AlertsService } from '../alerts/alerts.service';
import { StrategyService } from '../strategy/strategy.service';
import { IntentNodeService } from './intent-node.service';
import { PlanningNodeService } from './planning-node.service';
import { DataExecutorNodeService } from './data-executor-node.service';
import { AnalysisNodeService } from './analysis-node.service';
import { ReportNodeService } from './report-node.service';
import {
  Annotation,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';

type RunWorkflowInput = {
  query: string;
  timeWindow: '24h' | '7d';
  preferredChain: string | null;
  identity: AnalyzeIdentity;
};

export type WorkflowStage =
  | 'intent'
  | 'planning'
  | 'executor'
  | 'risk_strategy'
  | 'analysis'
  | 'report';

export type WorkflowStageEvent = {
  stage: WorkflowStage;
  timestamp: string;
};

type WorkflowRunOptions = {
  onStageCompleted?: (event: WorkflowStageEvent) => void;
  intentOverride?: IntentOutput;
};

const WorkflowStateAnnotation = Annotation.Root({
  query: Annotation<string>(),
  timeWindow: Annotation<'24h' | '7d'>(),
  preferredChain: Annotation<string | null>(),
  identity: Annotation<AnalyzeIdentity>(),
  onStageCompleted: Annotation<((event: WorkflowStageEvent) => void) | undefined>(),
  intent: Annotation<IntentOutput>(),
  plan: Annotation<PlanOutput>(),
  execution: Annotation<ExecutionOutput>(),
  alerts: Annotation<AlertsSnapshot>(),
  strategy: Annotation<StrategySnapshot>(),
  analysis: Annotation<AnalysisOutput>(),
  report: Annotation<ReportOutput>(),
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
    private readonly strategy: StrategyService,
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
    memo?: IntentMemoSnapshot | null;
  }): Promise<IntentOutput> {
    return this.intentNode.parse(input);
  }

  async run(input: RunWorkflowInput, options?: WorkflowRunOptions): Promise<WorkflowRunResult> {
    const state = (await this.workflowGraph.invoke({
      query: input.query,
      timeWindow: input.timeWindow,
      preferredChain: input.preferredChain,
      identity: input.identity,
      intent: options?.intentOverride,
      onStageCompleted: options?.onStageCompleted,
    })) as WorkflowGraphState;

    const intent = this.requireField(state.intent as IntentOutput | undefined, 'intent');
    const plan = this.requireField(state.plan as PlanOutput | undefined, 'plan');
    const execution = this.requireField(state.execution as ExecutionOutput | undefined, 'execution');
    const alerts = this.requireField(state.alerts as AlertsSnapshot | undefined, 'alerts');
    const strategy = this.requireField(state.strategy as StrategySnapshot | undefined, 'strategy');
    const analysis = this.requireField(state.analysis as AnalysisOutput | undefined, 'analysis');
    const report = this.requireField(state.report as ReportOutput | undefined, 'report');

    return {
      ...execution.data,
      intent,
      plan,
      execution,
      alerts,
      strategy,
      analysis,
      report,
    };
  }

  private buildGraph() {
    return new StateGraph(WorkflowStateAnnotation)
      .addNode('intent', async (state: WorkflowGraphState) => {
        const existingIntent = state.intent as IntentOutput | undefined;
        const intent =
          existingIntent ??
          (await this.intentNode.parse({
            query: state.query,
            timeWindow: state.timeWindow,
            preferredChain: state.preferredChain,
            memo: null,
          }));
        if (!existingIntent) {
          this.emitStageCompleted(state, 'intent');
        }
        return { intent };
      })
      .addNode('planning', async (state: WorkflowGraphState) => {
        const intent = this.requireField(state.intent as IntentOutput | undefined, 'intent');
        const plan = await this.planningNode.build({
          intent,
          identity: state.identity,
        });
        this.emitStageCompleted(state, 'planning');
        return { plan };
      })
      .addNode('executor', async (state: WorkflowGraphState) => {
        const plan = this.requireField(state.plan as PlanOutput | undefined, 'plan');
        const execution = await this.dataExecutorNode.execute({
          plan,
          identity: state.identity,
          timeWindow: state.timeWindow,
        });
        this.emitStageCompleted(state, 'executor');
        return { execution };
      })
      .addNode('risk_strategy', async (state: WorkflowGraphState) => {
        const execution = this.requireField(state.execution as ExecutionOutput | undefined, 'execution');
        const alerts = this.alerts.buildSnapshot({
          price: execution.data.market.price,
          onchain: execution.data.onchain.cexNetflow,
          security: execution.data.security,
          liquidity: execution.data.liquidity,
          tokenomics: execution.data.tokenomics,
        });
        const strategy = this.strategy.evaluate({
          price: execution.data.market.price,
          technical: execution.data.technical,
          onchain: execution.data.onchain.cexNetflow,
          security: execution.data.security,
          liquidity: execution.data.liquidity,
          tokenomics: execution.data.tokenomics,
          alerts,
        });
        this.emitStageCompleted(state, 'risk_strategy');
        return { alerts, strategy };
      })
      .addNode('analysis', async (state: WorkflowGraphState) => {
        const intent = this.requireField(state.intent as IntentOutput | undefined, 'intent');
        const plan = this.requireField(state.plan as PlanOutput | undefined, 'plan');
        const execution = this.requireField(state.execution as ExecutionOutput | undefined, 'execution');
        const alerts = this.requireField(state.alerts as AlertsSnapshot | undefined, 'alerts');
        const strategy = this.requireField(state.strategy as StrategySnapshot | undefined, 'strategy');
        const analysis = await this.analysisNode.analyze({
          intent,
          plan,
          execution,
          alerts,
          strategy,
        });
        this.emitStageCompleted(state, 'analysis');
        return { analysis };
      })
      .addNode('report', async (state: WorkflowGraphState) => {
        const intent = this.requireField(state.intent as IntentOutput | undefined, 'intent');
        const execution = this.requireField(state.execution as ExecutionOutput | undefined, 'execution');
        const analysis = this.requireField(state.analysis as AnalysisOutput | undefined, 'analysis');
        const alerts = this.requireField(state.alerts as AlertsSnapshot | undefined, 'alerts');
        const strategy = this.requireField(state.strategy as StrategySnapshot | undefined, 'strategy');
        const report = await this.reportNode.render({
          intent,
          execution,
          analysis,
          alerts,
          strategy,
        });
        this.emitStageCompleted(state, 'report');
        return { report };
      })
      .addEdge(START, 'intent')
      .addEdge('intent', 'planning')
      .addEdge('planning', 'executor')
      .addEdge('executor', 'risk_strategy')
      .addEdge('risk_strategy', 'analysis')
      .addEdge('analysis', 'report')
      .addEdge('report', END)
      .compile();
  }

  private emitStageCompleted(state: WorkflowGraphState, stage: WorkflowStage): void {
    const callback = state.onStageCompleted as
      | ((event: WorkflowStageEvent) => void)
      | undefined;
    callback?.({
      stage,
      timestamp: new Date().toISOString(),
    });
  }

  private requireField<T>(value: T | undefined, field: string): T {
    if (value === undefined) {
      throw new Error(`Workflow state missing required field: ${field}`);
    }
    return value;
  }
}

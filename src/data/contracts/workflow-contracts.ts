import { z } from 'zod';
import type {
  AlertsSnapshot,
  AnalyzeIdentity,
  CexNetflowSnapshot,
  FundamentalsSnapshot,
  LiquiditySnapshot,
  NewsSnapshot,
  OpenResearchSnapshot,
  PriceSnapshot,
  SecuritySnapshot,
  SentimentSnapshot,
  StrategySnapshot,
  TechnicalSnapshot,
  TokenomicsSnapshot,
} from './analyze-contracts';

export const dataTypeSchema = z.enum([
  'price',
  'news',
  'tokenomics',
  'technical',
  'onchain',
  'security',
  'liquidity',
  'fundamentals',
  'sentiment',
]);
export type DataType = z.infer<typeof dataTypeSchema>;

export const intentObjectiveSchema = z.enum([
  'market_overview',
  'risk_check',
  'timing_decision',
  'news_focus',
  'tokenomics_focus',
]);
export const intentInteractionTypeSchema = z.enum([
  'new_query',
  'follow_up',
  'selection_reply',
]);
export const intentTaskTypeSchema = z.enum([
  'single_asset',
  'multi_asset',
  'comparison',
]);
export const intentOutputGoalSchema = z.enum([
  'analysis',
  'strategy',
  'comparison',
]);
export const intentSentimentSchema = z.enum([
  'bullish',
  'bearish',
  'neutral',
  'unknown',
]);
export const intentFocusAreaSchema = z.enum([
  'price_action',
  'news_events',
  'tokenomics',
  'technical_indicators',
  'onchain_flow',
  'security_risk',
  'liquidity_quality',
  'project_fundamentals',
]);

export const intentLlmOutputSchema = z.object({
  interactionType: intentInteractionTypeSchema,
  taskType: intentTaskTypeSchema,
  targets: z.array(z.string().min(1)).max(5).default([]),
  timeWindow: z.enum(['24h', '7d', '30d', '60d', 'unspecified']),
  outputGoal: intentOutputGoalSchema,
  needsClarification: z.boolean(),
});
export type IntentLlmOutput = z.infer<typeof intentLlmOutputSchema>;

export const intentOutputSchema = z.object({
  userQuery: z.string().min(1),
  language: z.enum(['zh', 'en', 'cn']),
  interactionType: intentInteractionTypeSchema,
  taskType: intentTaskTypeSchema,
  outputGoal: intentOutputGoalSchema,
  needsClarification: z.boolean(),
  objective: intentObjectiveSchema,
  sentimentBias: intentSentimentSchema,
  timeWindow: z.enum(['24h', '7d', '30d', '60d']),
  entities: z.array(z.string()).default([]),
  entityMentions: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  chains: z.array(z.string()).default([]),
  focusAreas: z.array(intentFocusAreaSchema).min(1),
  constraints: z.array(z.string()).default([]),
});
export type IntentOutput = z.infer<typeof intentOutputSchema>;

export type IntentMemoResolvedTarget = {
  targetKey: string;
  identity: AnalyzeIdentity;
};

export type IntentMemoSnapshot = {
  threadId: string;
  lastIntent: IntentOutput;
  lastResolvedTargets: IntentMemoResolvedTarget[];
  lastRequestId: string;
  updatedAt: string;
};

export const planPrioritySchema = z.enum(['high', 'medium', 'low']);
export const planResponseModeSchema = z.enum(['explain', 'assess', 'act']);
export type PlanResponseMode = z.infer<typeof planResponseModeSchema>;
export const planTaskDispositionSchema = z.enum([
  'analyze',
  'clarify',
  'non_analysis',
  'refuse',
]);
export type PlanTaskDisposition = z.infer<typeof planTaskDispositionSchema>;
export const planSearchDepthSchema = z.enum(['light', 'standard', 'heavy']);
export type PlanSearchDepth = z.infer<typeof planSearchDepthSchema>;

export const planRequirementSchema = z.object({
  dataType: dataTypeSchema,
  required: z.boolean(),
  priority: planPrioritySchema,
  sourceHint: z.array(z.string()).default([]),
  reason: z.string().min(1),
});
export type PlanRequirement = z.infer<typeof planRequirementSchema>;

export const planOpenResearchSchema = z.object({
  enabled: z.boolean(),
  depth: planSearchDepthSchema,
  priority: planPrioritySchema,
  reason: z.string().min(1),
  topics: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  preferredSources: z.array(z.string()).default([]),
  mustUseInReport: z.boolean().default(true),
});
export type PlanOpenResearch = z.infer<typeof planOpenResearchSchema>;

export const planOutputSchema = z.object({
  taskDisposition: planTaskDispositionSchema,
  primaryIntent: z.string().min(1),
  subTasks: z.array(z.string().min(1)).min(1),
  responseMode: planResponseModeSchema,
  requirements: z.array(planRequirementSchema).min(1),
  analysisQuestions: z.array(z.string()).min(1),
  openResearch: planOpenResearchSchema,
});
export type PlanOutput = z.infer<typeof planOutputSchema>;

export type ExecutionPayload = {
  market: { price: PriceSnapshot };
  news: NewsSnapshot;
  openResearch: OpenResearchSnapshot;
  tokenomics: TokenomicsSnapshot;
  fundamentals: FundamentalsSnapshot;
  technical: TechnicalSnapshot;
  onchain: { cexNetflow: CexNetflowSnapshot };
  security: SecuritySnapshot;
  liquidity: LiquiditySnapshot;
  sentiment: SentimentSnapshot;
};

export type ExecutionRoutingItem = {
  dataType: DataType;
  sourceHint: string[];
  selectedSource: string;
};

export type ExecutionOutput = {
  identity: AnalyzeIdentity;
  requestedTypes: DataType[];
  executedTypes: DataType[];
  collectedTypes: DataType[];
  degradedNodes: DataType[];
  missingEvidence: string[];
  routing: ExecutionRoutingItem[];
  data: ExecutionPayload;
  asOf: string;
};

const analysisPriceLevelSchema = z.object({
  price: z.number(),
  source: z.enum([
    'boll_lower',
    'boll_upper',
    'boll_middle',
    'ma7',
    'ma25',
    'ma99',
    'ath',
    'atl',
    'fib_0236',
    'fib_0382',
    'fib_0500',
    'fib_0618',
    'fib_0786',
    'swing_high',
    'swing_low',
    'psychological',
  ]),
  label: z.string(),
  strength: z.enum(['weak', 'medium', 'strong']),
});

const analysisStopLossReferenceSchema = z.object({
  price: z.number(),
  pctFromEntry: z.number(),
  source: z.enum([
    'atr',
    'boll_lower',
    'ma25',
    'fib_0786',
    'swing_low',
    'fixed_pct',
  ]),
  label: z.string(),
});

const analysisTakeProfitLevelSchema = z.object({
  price: z.number(),
  pctFromEntry: z.number(),
  label: z.string(),
  strength: z.enum(['weak', 'medium', 'strong']),
});

const analysisTradingStrategySchema = z.object({
  entryPrice: z.number().nullable(),
  entryZone: z.string().nullable(),
  supportLevels: z.array(analysisPriceLevelSchema),
  resistanceLevels: z.array(analysisPriceLevelSchema),
  stopLoss: analysisStopLossReferenceSchema.nullable(),
  takeProfitLevels: z.array(analysisTakeProfitLevelSchema),
  riskRewardRatio: z.number().nullable(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  note: z.string(),
});

export const analysisOutputSchema = z.object({
  verdict: z.enum(['BUY', 'SELL', 'HOLD', 'CAUTION', 'INSUFFICIENT_DATA']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  buyZone: z.string().nullable(),
  sellZone: z.string().nullable(),
  evidence: z.array(z.string()).min(1),
  summary: z.string().min(1),
  keyObservations: z.array(z.string()).min(1),
  hardBlocks: z.array(z.string()).default([]),
  riskHighlights: z.array(z.string()).default([]),
  opportunityHighlights: z.array(z.string()).default([]),
  dataQualityNotes: z.array(z.string()).default([]),
  tradingStrategy: analysisTradingStrategySchema.optional(),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const reportSectionSchema = z.object({
  heading: z.string().min(1),
  points: z.array(z.string()).min(1),
});

export const reportAllocationWeightSchema = z.object({
  symbol: z.string().min(1),
  weightPct: z.number().min(0).max(100).nullable(),
  rationale: z.string().min(1),
});

export const reportAllocationGuidanceSchema = z.object({
  summary: z.string().min(1),
  preferred: z.array(z.string()).default([]),
  secondary: z.array(z.string()).default([]),
  avoided: z.array(z.string()).default([]),
  weights: z.array(reportAllocationWeightSchema).default([]),
});

export const reportScenarioSchema = z.object({
  scenario: z.enum(['bull', 'base', 'bear']),
  summary: z.string().min(1),
  trigger: z.string().min(1),
});

export const reportMetaSchema = z.object({
  keyTakeaway: z.string().min(1),
  whyNow: z.array(z.string()).min(1),
  actionGuidance: z.array(z.string()).default([]),
  keyTriggers: z.array(z.string()).default([]),
  invalidationSignals: z.array(z.string()).default([]),
  dataQualityNotes: z.array(z.string()).default([]),
  allocationGuidance: reportAllocationGuidanceSchema.optional(),
  scenarioMap: z.array(reportScenarioSchema).default([]),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportOutputSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string().min(1),
  body: z.string().min(1),
  sections: z.array(reportSectionSchema).min(1),
  reportMeta: reportMetaSchema.optional(),
  verdict: z.enum(['BUY', 'SELL', 'HOLD', 'CAUTION', 'INSUFFICIENT_DATA']),
  confidence: z.number().min(0).max(1),
  disclaimer: z.string().min(1),
});
export type ReportOutput = z.infer<typeof reportOutputSchema>;

export const workflowNodeLlmStatusSchema = z.enum([
  'success',
  'retry_success',
  'fallback',
  'skipped',
]);
export type WorkflowNodeLlmStatus = z.infer<typeof workflowNodeLlmStatusSchema>;

export const workflowNodeExecutionMetaSchema = z.object({
  llmStatus: workflowNodeLlmStatusSchema,
  attempts: z.number().int().min(0),
  schemaCorrection: z.boolean(),
  failureReason: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});
export type WorkflowNodeExecutionMeta = z.infer<
  typeof workflowNodeExecutionMetaSchema
>;

export type WorkflowNodeStatus = {
  intent?: WorkflowNodeExecutionMeta;
  planning?: WorkflowNodeExecutionMeta;
  executor?: WorkflowNodeExecutionMeta;
  analysis?: WorkflowNodeExecutionMeta;
  report?: WorkflowNodeExecutionMeta;
};

export type WorkflowRunResult = ExecutionPayload & {
  intent: IntentOutput;
  plan: PlanOutput;
  execution: ExecutionOutput;
  alerts: AlertsSnapshot;
  strategy: StrategySnapshot;
  analysis: AnalysisOutput;
  report: ReportOutput;
  nodeStatus: WorkflowNodeStatus;
};

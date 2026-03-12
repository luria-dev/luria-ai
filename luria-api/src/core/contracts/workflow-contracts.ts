import { z } from 'zod';
import type {
  AlertsSnapshot,
  AnalyzeIdentity,
  CexNetflowSnapshot,
  LiquiditySnapshot,
  NewsSnapshot,
  PriceSnapshot,
  SecuritySnapshot,
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
]);
export type DataType = z.infer<typeof dataTypeSchema>;

export const intentObjectiveSchema = z.enum([
  'market_overview',
  'risk_check',
  'timing_decision',
  'news_focus',
  'tokenomics_focus',
]);
export const intentTaskTypeSchema = z.enum(['single_asset', 'comparison']);
export const intentSentimentSchema = z.enum(['bullish', 'bearish', 'neutral', 'unknown']);
export const intentFocusAreaSchema = z.enum([
  'price_action',
  'news_events',
  'tokenomics',
  'technical_indicators',
  'onchain_flow',
  'security_risk',
  'liquidity_quality',
]);

export const intentOutputSchema = z.object({
  userQuery: z.string().min(1),
  language: z.enum(['zh', 'en']),
  taskType: intentTaskTypeSchema,
  objective: intentObjectiveSchema,
  sentimentBias: intentSentimentSchema,
  timeWindow: z.enum(['24h', '7d']),
  entities: z.array(z.string()).default([]),
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

export const planRequirementSchema = z.object({
  dataType: dataTypeSchema,
  required: z.boolean(),
  priority: planPrioritySchema,
  sourceHint: z.array(z.string()).default([]),
  reason: z.string().min(1),
});
export type PlanRequirement = z.infer<typeof planRequirementSchema>;

export const planOutputSchema = z.object({
  requirements: z.array(planRequirementSchema).min(1),
  analysisQuestions: z.array(z.string()).min(1),
});
export type PlanOutput = z.infer<typeof planOutputSchema>;

export type ExecutionPayload = {
  market: { price: PriceSnapshot };
  news: NewsSnapshot;
  tokenomics: TokenomicsSnapshot;
  technical: TechnicalSnapshot;
  onchain: { cexNetflow: CexNetflowSnapshot };
  security: SecuritySnapshot;
  liquidity: LiquiditySnapshot;
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

export const analysisOutputSchema = z.object({
  summary: z.string().min(1),
  keyObservations: z.array(z.string()).min(1),
  riskHighlights: z.array(z.string()).default([]),
  opportunityHighlights: z.array(z.string()).default([]),
  dataQualityNotes: z.array(z.string()).default([]),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const reportSectionSchema = z.object({
  heading: z.string().min(1),
  points: z.array(z.string()).min(1),
});

export const reportOutputSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string().min(1),
  sections: z.array(reportSectionSchema).min(1),
  verdict: z.enum(['BUY', 'SELL', 'HOLD', 'CAUTION', 'INSUFFICIENT_DATA']),
  confidence: z.number().min(0).max(1),
  disclaimer: z.string().min(1),
});
export type ReportOutput = z.infer<typeof reportOutputSchema>;

export type WorkflowRunResult = ExecutionPayload & {
  intent: IntentOutput;
  plan: PlanOutput;
  execution: ExecutionOutput;
  alerts: AlertsSnapshot;
  strategy: StrategySnapshot;
  analysis: AnalysisOutput;
  report: ReportOutput;
};

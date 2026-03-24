import type { WorkflowRunResult } from '../../../data/contracts/workflow-contracts';
import type { ComparisonScoringConfig } from './comparison-scoring-config';
import { defaultComparisonScoringConfig } from './comparison-scoring-config';

export type ComparisonScoreBreakdown = {
  total: number;
  components: {
    verdictBase: number;
    confidence: number;
    redAlerts: number;
    yellowAlerts: number;
    degradedNodes: number;
    honeypot: number;
    criticalSecurity: number;
    withdrawalRisk: number;
  };
};

export function scoreWorkflowForComparison(
  pipeline: WorkflowRunResult,
  config: ComparisonScoringConfig = defaultComparisonScoringConfig,
): ComparisonScoreBreakdown {
  const advisory = pipeline.analysis;
  const verdictBase = config.verdictBase[advisory.verdict];
  const confidence = advisory.confidence * config.confidenceMultiplier;
  const redAlerts = pipeline.alerts.redCount * config.redAlertPenalty;
  const yellowAlerts = pipeline.alerts.yellowCount * config.yellowAlertPenalty;
  const degradedNodes =
    pipeline.execution.degradedNodes.length * config.degradedNodePenalty;
  const honeypot = pipeline.execution.data.security.isHoneypot
    ? config.honeypotPenalty
    : 0;
  const criticalSecurity =
    pipeline.execution.data.security.riskLevel === 'critical'
      ? config.criticalSecurityPenalty
      : 0;
  const withdrawalRisk = pipeline.execution.data.liquidity.withdrawalRiskFlag
    ? config.withdrawalRiskPenalty
    : 0;

  const total =
    verdictBase +
    confidence -
    redAlerts -
    yellowAlerts -
    degradedNodes -
    honeypot -
    criticalSecurity -
    withdrawalRisk;

  return {
    total: Number(total.toFixed(2)),
    components: {
      verdictBase,
      confidence: Number(confidence.toFixed(2)),
      redAlerts,
      yellowAlerts,
      degradedNodes,
      honeypot,
      criticalSecurity,
      withdrawalRisk,
    },
  };
}

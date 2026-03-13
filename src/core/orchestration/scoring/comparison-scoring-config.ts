import type { StrategyVerdict } from '../../../data/contracts/analyze-contracts';

export type ComparisonScoringConfig = {
  verdictBase: Record<StrategyVerdict, number>;
  confidenceMultiplier: number;
  redAlertPenalty: number;
  yellowAlertPenalty: number;
  degradedNodePenalty: number;
  honeypotPenalty: number;
  criticalSecurityPenalty: number;
  withdrawalRiskPenalty: number;
};

export const defaultComparisonScoringConfig: ComparisonScoringConfig = {
  verdictBase: {
    BUY: 30,
    HOLD: 15,
    CAUTION: 5,
    SELL: -10,
    INSUFFICIENT_DATA: -20,
  },
  confidenceMultiplier: 40,
  redAlertPenalty: 12,
  yellowAlertPenalty: 4,
  degradedNodePenalty: 2,
  honeypotPenalty: 30,
  criticalSecurityPenalty: 20,
  withdrawalRiskPenalty: 10,
};

function parseNumberWithFallback(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  if (raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export function resolveComparisonScoringConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ComparisonScoringConfig {
  return {
    verdictBase: {
      BUY: parseNumberWithFallback(
        env.ANALYZE_COMPARE_BASE_BUY,
        defaultComparisonScoringConfig.verdictBase.BUY,
      ),
      HOLD: parseNumberWithFallback(
        env.ANALYZE_COMPARE_BASE_HOLD,
        defaultComparisonScoringConfig.verdictBase.HOLD,
      ),
      CAUTION: parseNumberWithFallback(
        env.ANALYZE_COMPARE_BASE_CAUTION,
        defaultComparisonScoringConfig.verdictBase.CAUTION,
      ),
      SELL: parseNumberWithFallback(
        env.ANALYZE_COMPARE_BASE_SELL,
        defaultComparisonScoringConfig.verdictBase.SELL,
      ),
      INSUFFICIENT_DATA: parseNumberWithFallback(
        env.ANALYZE_COMPARE_BASE_INSUFFICIENT,
        defaultComparisonScoringConfig.verdictBase.INSUFFICIENT_DATA,
      ),
    },
    confidenceMultiplier: parseNumberWithFallback(
      env.ANALYZE_COMPARE_MULTIPLIER_CONFIDENCE,
      defaultComparisonScoringConfig.confidenceMultiplier,
    ),
    redAlertPenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_RED_ALERT,
      defaultComparisonScoringConfig.redAlertPenalty,
    ),
    yellowAlertPenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_YELLOW_ALERT,
      defaultComparisonScoringConfig.yellowAlertPenalty,
    ),
    degradedNodePenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_DEGRADED_NODE,
      defaultComparisonScoringConfig.degradedNodePenalty,
    ),
    honeypotPenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_HONEYPOT,
      defaultComparisonScoringConfig.honeypotPenalty,
    ),
    criticalSecurityPenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_CRITICAL_SECURITY,
      defaultComparisonScoringConfig.criticalSecurityPenalty,
    ),
    withdrawalRiskPenalty: parseNumberWithFallback(
      env.ANALYZE_COMPARE_PENALTY_WITHDRAWAL_RISK,
      defaultComparisonScoringConfig.withdrawalRiskPenalty,
    ),
  };
}

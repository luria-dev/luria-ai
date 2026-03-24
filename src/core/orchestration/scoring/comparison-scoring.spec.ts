import type { WorkflowRunResult } from '../../../data/contracts/workflow-contracts';
import {
  defaultComparisonScoringConfig,
  type ComparisonScoringConfig,
} from './comparison-scoring-config';
import { scoreWorkflowForComparison } from './comparison-scoring';

function buildMockWorkflowResult(): WorkflowRunResult {
  return {
    analysis: {
      verdict: 'BUY',
      confidence: 0.6,
    },
    strategy: {
      verdict: 'BUY',
      confidence: 0.6,
    },
    alerts: {
      redCount: 1,
      yellowCount: 2,
    },
    execution: {
      degradedNodes: ['news', 'technical'],
      data: {
        security: {
          isHoneypot: true,
          riskLevel: 'critical',
        },
        liquidity: {
          withdrawalRiskFlag: true,
        },
      },
    },
  } as unknown as WorkflowRunResult;
}

describe('scoreWorkflowForComparison', () => {
  it('should apply default scoring config with penalties', () => {
    const scoring = scoreWorkflowForComparison(buildMockWorkflowResult());

    expect(scoring.components.verdictBase).toBe(
      defaultComparisonScoringConfig.verdictBase.BUY,
    );
    expect(scoring.components.confidence).toBe(24);
    expect(scoring.components.redAlerts).toBe(12);
    expect(scoring.components.yellowAlerts).toBe(8);
    expect(scoring.components.degradedNodes).toBe(4);
    expect(scoring.components.honeypot).toBe(30);
    expect(scoring.components.criticalSecurity).toBe(20);
    expect(scoring.components.withdrawalRisk).toBe(10);
    expect(scoring.total).toBe(-30);
  });

  it('should support custom config overrides', () => {
    const custom: ComparisonScoringConfig = {
      ...defaultComparisonScoringConfig,
      confidenceMultiplier: 10,
      honeypotPenalty: 0,
    };
    const scoring = scoreWorkflowForComparison(buildMockWorkflowResult(), custom);

    expect(scoring.components.confidence).toBe(6);
    expect(scoring.components.honeypot).toBe(0);
    expect(scoring.total).toBe(-18);
  });

  it('should prioritize analysis over strategy when both exist', () => {
    const scoring = scoreWorkflowForComparison({
      ...buildMockWorkflowResult(),
      analysis: {
        verdict: 'HOLD',
        confidence: 0.2,
      },
      strategy: {
        verdict: 'BUY',
        confidence: 0.9,
      },
    } as WorkflowRunResult);

    expect(scoring.components.verdictBase).toBe(
      defaultComparisonScoringConfig.verdictBase.HOLD,
    );
    expect(scoring.components.confidence).toBe(8);
  });
});

import type { StrategyVerdict } from '../../../data/contracts/analyze-contracts';
import type { DataType } from '../../../data/contracts/workflow-contracts';
import type { TargetPipeline } from '../orchestration.types';
import { ComparisonService } from './comparison.service';

type BuildTargetParams = {
  targetKey: string;
  symbol: string;
  verdict: StrategyVerdict;
  confidence: number;
  redAlerts?: number;
  yellowAlerts?: number;
  degradedNodeCount?: number;
  language?: 'zh' | 'en';
};

function buildDegradedNodes(count: number): DataType[] {
  const nodes: DataType[] = [
    'price',
    'news',
    'tokenomics',
    'technical',
    'onchain',
    'liquidity',
    'security',
  ];
  return nodes.slice(0, Math.max(0, count));
}

function buildTarget(params: BuildTargetParams): TargetPipeline {
  return {
    targetKey: params.targetKey,
    identity: {
      symbol: params.symbol,
      chain: 'ethereum',
      tokenAddress: `0x${params.targetKey}`,
      sourceId: `coingecko:${params.symbol.toLowerCase()}`,
    },
    pipeline: {
      intent: {
        language: params.language ?? 'en',
      },
      analysis: {
        verdict: params.verdict,
        confidence: params.confidence,
      },
      strategy: {
        verdict: params.verdict,
        confidence: params.confidence,
      },
      alerts: {
        redCount: params.redAlerts ?? 0,
        yellowCount: params.yellowAlerts ?? 0,
      },
      execution: {
        degradedNodes: buildDegradedNodes(params.degradedNodeCount ?? 0),
        data: {
          security: {
            isHoneypot: false,
            riskLevel: 'low',
          },
          liquidity: {
            withdrawalRiskFlag: false,
          },
        },
      },
    },
  } as unknown as TargetPipeline;
}

describe('ComparisonService', () => {
  const service = new ComparisonService();

  it('should not choose winner when top score is tied', () => {
    const summary = service.buildComparisonSummary('A vs B', [
      buildTarget({
        targetKey: 'A',
        symbol: 'AAA',
        verdict: 'BUY',
        confidence: 0.6,
      }),
      buildTarget({
        targetKey: 'B',
        symbol: 'BBB',
        verdict: 'BUY',
        confidence: 0.6,
      }),
    ]);

    expect(summary.winner).toBeNull();
    expect(summary.summary).toContain('cannot be determined');
  });

  it('should not choose winner when best candidate is still insufficient data', () => {
    const summary = service.buildComparisonSummary('UNI vs LINK', [
      buildTarget({
        targetKey: 'UNI',
        symbol: 'UNI',
        verdict: 'INSUFFICIENT_DATA',
        confidence: 0.9,
      }),
      buildTarget({
        targetKey: 'LINK',
        symbol: 'LINK',
        verdict: 'SELL',
        confidence: 0.2,
      }),
    ]);

    expect(summary.winner).toBeNull();
  });

  it('should choose winner when top score is unique and actionable', () => {
    const summary = service.buildComparisonSummary('A vs B', [
      buildTarget({
        targetKey: 'A',
        symbol: 'AAA',
        verdict: 'BUY',
        confidence: 0.7,
      }),
      buildTarget({
        targetKey: 'B',
        symbol: 'BBB',
        verdict: 'HOLD',
        confidence: 0.2,
      }),
    ]);

    expect(summary.winner?.targetKey).toBe('A');
    expect(summary.winner?.symbol).toBe('AAA');
  });

  it('should prioritize analysis verdict over compatibility strategy field', () => {
    const summary = service.buildComparisonSummary('A vs B', [
      {
        ...buildTarget({
          targetKey: 'A',
          symbol: 'AAA',
          verdict: 'HOLD',
          confidence: 0.2,
        }),
        pipeline: {
          ...buildTarget({
            targetKey: 'A',
            symbol: 'AAA',
            verdict: 'HOLD',
            confidence: 0.2,
          }).pipeline,
          analysis: {
            verdict: 'BUY',
            confidence: 0.8,
          },
          strategy: {
            verdict: 'SELL',
            confidence: 0.1,
          },
        },
      } as TargetPipeline,
      buildTarget({
        targetKey: 'B',
        symbol: 'BBB',
        verdict: 'HOLD',
        confidence: 0.2,
      }),
    ]);

    expect(summary.ranked[0]?.symbol).toBe('AAA');
    expect(summary.ranked[0]?.verdict).toBe('BUY');
    expect(summary.ranked[0]?.reasons[0]).toContain('analysis=BUY');
  });
});

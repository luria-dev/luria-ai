import {
  defaultComparisonScoringConfig,
  resolveComparisonScoringConfigFromEnv,
} from './comparison-scoring-config';

describe('resolveComparisonScoringConfigFromEnv', () => {
  it('should use defaults when env is empty', () => {
    const config = resolveComparisonScoringConfigFromEnv({});
    expect(config).toEqual(defaultComparisonScoringConfig);
  });

  it('should apply numeric env overrides', () => {
    const config = resolveComparisonScoringConfigFromEnv({
      ANALYZE_COMPARE_BASE_BUY: '42',
      ANALYZE_COMPARE_BASE_SELL: '-15',
      ANALYZE_COMPARE_MULTIPLIER_CONFIDENCE: '25',
      ANALYZE_COMPARE_PENALTY_HONEYPOT: '50',
    });

    expect(config.verdictBase.BUY).toBe(42);
    expect(config.verdictBase.SELL).toBe(-15);
    expect(config.confidenceMultiplier).toBe(25);
    expect(config.honeypotPenalty).toBe(50);
  });

  it('should fallback for invalid env values', () => {
    const config = resolveComparisonScoringConfigFromEnv({
      ANALYZE_COMPARE_BASE_HOLD: 'not-a-number',
      ANALYZE_COMPARE_PENALTY_RED_ALERT: '',
    });

    expect(config.verdictBase.HOLD).toBe(
      defaultComparisonScoringConfig.verdictBase.HOLD,
    );
    expect(config.redAlertPenalty).toBe(
      defaultComparisonScoringConfig.redAlertPenalty,
    );
  });
});

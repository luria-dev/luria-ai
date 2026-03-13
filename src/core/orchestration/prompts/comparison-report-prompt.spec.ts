import { buildComparisonReportTemplate } from './comparison-report-prompt';

describe('buildComparisonReportTemplate', () => {
  it('should render english winner summary with orchestration-level winner note', () => {
    const result = buildComparisonReportTemplate({
      language: 'en',
      query: 'Aster vs Hyper, which is better?',
      winner: {
        symbol: 'ASTER',
        chain: 'ethereum',
      },
    });

    expect(result.title).toBe('Multi-Target Comparison Report');
    expect(result.summary).toContain('ASTER');
    expect(result.summary).toContain('orchestration summary level');
  });

  it('should render chinese fallback summary when winner is missing', () => {
    const result = buildComparisonReportTemplate({
      language: 'zh',
      query: 'Aster 和 Hyper 谁更适合投资？',
      winner: null,
    });

    expect(result.title).toBe('多标的对比分析报告');
    expect(result.summary).toContain('无法给出最终胜者');
    expect(result.noValidTargetsText).toBe('无有效候选。');
  });
});

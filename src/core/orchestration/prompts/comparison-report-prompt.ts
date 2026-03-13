export type ComparisonReportTemplateInput = {
  language: 'zh' | 'en';
  query: string;
  winner: {
    symbol: string;
    chain: string;
  } | null;
};

export type ComparisonReportTemplate = {
  title: string;
  rankingHeading: string;
  riskHeading: string;
  rationaleHeading: string;
  conclusionHeading: string;
  noValidTargetsText: string;
  summary: string;
  disclaimer: string;
};

export function buildComparisonReportTemplate(
  input: ComparisonReportTemplateInput,
): ComparisonReportTemplate {
  const isZh = input.language === 'zh';

  const summary = input.winner
    ? isZh
      ? `基于统一评分框架，${input.winner.symbol}(${input.winner.chain}) 在当前问题“${input.query}”中综合排名第一。最终胜者仅在汇总层给出。`
      : `Under a unified scoring rubric, ${input.winner.symbol} (${input.winner.chain}) ranks first for query "${input.query}". Final winner is declared only at orchestration summary level.`
    : isZh
      ? '未能生成有效对比结果，当前无法给出最终胜者。'
      : 'No valid comparison result was produced; final winner cannot be determined.';

  return {
    title: isZh ? '多标的对比分析报告' : 'Multi-Target Comparison Report',
    rankingHeading: isZh ? '综合排名' : 'Ranking',
    riskHeading: isZh ? '风险对比' : 'Risk Comparison',
    rationaleHeading: isZh ? '排名依据' : 'Ranking Rationale',
    conclusionHeading: isZh ? '结论' : 'Conclusion',
    noValidTargetsText: isZh ? '无有效候选。' : 'No valid targets.',
    summary,
    disclaimer: isZh
      ? '本报告仅供研究参考，不构成投资建议。'
      : 'This report is for research purposes only and is not investment advice.',
  };
}

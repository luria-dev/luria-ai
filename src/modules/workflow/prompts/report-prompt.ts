import type {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
} from '../../../data/contracts/workflow-contracts';
import type { AlertsSnapshot } from '../../../data/contracts/analyze-contracts';
import { PromptBundle } from './prompt-types';

export type ReportPromptContext = {
  language: IntentOutput['language'];
  query: IntentOutput['userQuery'];
  taskType: IntentOutput['taskType'];
  objective: IntentOutput['objective'];
  sentimentBias: IntentOutput['sentimentBias'];
  entities: IntentOutput['entities'];
  focusAreas: IntentOutput['focusAreas'];
  conversationHistoryRaw: string | null;
  planning: {
    taskDisposition: PlanOutput['taskDisposition'];
    primaryIntent: PlanOutput['primaryIntent'];
    subTasks: PlanOutput['subTasks'];
    responseMode: PlanOutput['responseMode'];
    requiredModules: Array<{
      dataType: PlanOutput['requirements'][number]['dataType'];
      priority: PlanOutput['requirements'][number]['priority'];
      reason: string;
    }>;
    analysisQuestions: PlanOutput['analysisQuestions'];
    openResearch: PlanOutput['openResearch'];
  };
  target: {
    symbol: ExecutionOutput['identity']['symbol'];
    chain: ExecutionOutput['identity']['chain'];
    tokenAddress: ExecutionOutput['identity']['tokenAddress'];
  };
  market: {
    priceUsd: number | null;
    change24hPct: number | null;
    change7dPct: number | null;
    volume24hUsd: number | null;
    marketCapRank: number | null;
  };
  recentEvidence: {
    news: Array<{
      title: string;
      source: string;
      publishedAt: string;
      category: string;
      relevanceScore: number;
      url: string;
    }>;
    openResearch: {
      enabled: boolean;
      depth: PlanOutput['openResearch']['depth'];
      mustUseInReport: PlanOutput['openResearch']['mustUseInReport'];
      goals: string[];
      topics: string[];
      takeaways: string[];
      items: Array<{
        title: string;
        source: string;
        topic: string;
        snippet: string | null;
        url: string;
      }>;
    };
  };
  signals: {
    technical: string;
    technicalDetails: {
      rsi: { value: number | null; signal: string };
      macd: { value: number | null; signal: string; histogram: number | null };
      ma: {
        ma7: number | null;
        ma25: number | null;
        ma99: number | null;
        signal: string;
      };
      boll: {
        upper: number | null;
        middle: number | null;
        lower: number | null;
        signal: string;
      };
      atr: number | null;
      swingHigh: number | null;
      swingLow: number | null;
    };
    onchain: string;
    sentiment: string;
    sentimentDetails: {
      socialVolume: number | null;
      sentimentScore: number | null;
      sentimentPositive: number | null;
      sentimentNegative: number | null;
      devActivity: number | null;
    };
    securityRisk: string;
    liquidityUsd: number | null;
    liquidityDetails: {
      volume24hUsd: number | null;
      liquidityDrop1hPct: number | null;
      priceImpact1kPct: number | null;
      rugpullRiskSignal: string;
    };
    inflationRate: number | null;
    projectName: string | null;
    projectOneLiner: string | null;
    fundamentalsTags: string[];
  };
  decision: {
    verdict: AnalysisOutput['verdict'];
    confidence: number;
    reason: string;
    buyZone: string | null;
    sellZone: string | null;
    evidence: string[];
    hardBlocks: string[];
    tradingStrategy: AnalysisOutput['tradingStrategy'];
  };
  insights: {
    summary: string;
    keyObservations: string[];
    riskHighlights: string[];
    opportunityHighlights: string[];
  };
  alerts: {
    level: AlertsSnapshot['alertLevel'];
    riskState: AlertsSnapshot['riskState'];
    redCount: number;
    yellowCount: number;
    topItems: string[];
  };
  anomalies: {
    priceVolatility: string | null;
    socialActivity: string | null;
    onchainFlow: string | null;
    riskEscalation: string | null;
  };
  tokenomics: {
    burns: {
      totalBurnAmount: number | null;
      recentBurnCount: number;
      latestBurnDate: string | null;
      burnSummary: string | null;
    };
    buybacks: {
      totalBuybackAmount: number | null;
      recentBuybackCount: number;
      latestBuybackDate: string | null;
      buybackSummary: string | null;
    };
    fundraising: {
      totalRaised: number | null;
      roundCount: number;
      latestRoundDate: string | null;
      fundraisingSummary: string | null;
    };
  };
};

export function buildReportPrompts(context: ReportPromptContext): PromptBundle {
  const isZh = context.language === 'zh' || context.language === 'cn';
  const intentRouting = buildIntentRouting(context, isZh);
  const responseModeLabel = isZh
    ? {
        explain: '解释型',
        assess: '评估型',
        act: '操作型',
      }[context.planning.responseMode]
    : context.planning.responseMode;

  const systemPrompt = `
You are a crypto research writer. Your job is to turn the supplied evidence into a clear, task-oriented report that ordinary readers can understand.

## Core Workflow
1. Infer the user's real task from the latest question, the full conversation transcript, and the planning questions.
2. Break the user ask into explicit sub-questions and make sure all of them are answered.
3. Choose the 2-4 modules that best answer that task.
4. Let the chosen primary modules dominate the report.
5. Mention secondary modules only when they materially change the conclusion.

## Response Mode
- explain: help the reader understand what happened, what changed, and what matters.
- assess: help the reader judge whether the asset currently looks attractive or risky as an investment.
- act: help the reader think about execution, timing, entry, exit, support, or resistance.
- Do not write an act-style report unless the supplied responseMode is act or the user explicitly asks for execution timing.

Available modules:
- 近期动态 / Recent changes
- 市场情况 / Market state
- 链上与流动性 / On-chain and liquidity
- 情绪与资金面 / Sentiment and positioning
- 技术分析 / Technical structure
- 基本面 / Fundamentals
- 代币经济学 / Tokenomics
- 交易计划 / Trade setup
- 风险提示 / Risk warnings

## Output Structure
- Start with a direct title that states the core conclusion.
- "## 关键回答" / "## Core Answer" is mandatory.
- After that, include only the sections needed for the user's task.
- The body must begin with a single "# " title line.
- Use "##" for main sections and "###" for sub-sections when needed.
- Never use numbered headings.
- When the supplied evidence contains at least 3 usable structured metrics, include 1 compact markdown table near the top. Do not default to a pure long-form essay.
- That first table should usually be "关键数据快照" / "Key Snapshot".
- If open research or news evidence materially affects the answer, prefer a second compact table instead of burying those points in prose.
- Choose the second table by question type:
  - recent developments / ecosystem progress -> "外部证据摘要" / "External Evidence Summary"
  - drivers / biggest risks / investability -> "核心驱动与风险" / "Drivers and Risks"
  - fundamentals vs sentiment -> "基本面 vs 情绪证据" / "Fundamentals vs Sentiment"
- For explain mode, prefer sections such as recent changes, what is driving it, what it means, and what remains uncertain.
- For assess mode, prefer sections such as core reasons, biggest risks, and how to think about the investment case now.
- Include "## 交易计划" / "## Trade Setup" only when responseMode = act or the user is explicitly asking what to do now, timing, entry, exit, support, or resistance.
- Include "## 风险提示" / "## Risk Warnings" whenever risk materially affects the thesis.

## Evidence Discipline
- Use only the supplied input: raw conversation history, planning guidance, structured data, news items, and open research items.
- Do not invent catalysts, macro narratives, ETF flows, regulation themes, whales, institutions, upgrades, roadmaps, governance items, future events, or unsupported explanations.
- Do not invent support, resistance, trigger, invalidation, or target levels.
- Do not introduce unsupported timeframes such as quarter, cycle, or long term.
- If evidence is missing, state that directly instead of filling gaps with speculation.
- Respect the supplied verdict and discuss only the target symbol.
- If open research is enabled, treat it as real evidence rather than decorative appendix material.
- For questions about recent developments, drivers, risks, ecosystem progress, or whether a move is fundamentals vs sentiment, the answer should actively use open-web evidence together with the structured data.
- When external evidence and structured signals point in different directions, state that tension explicitly and explain which side you trust more.

## Presentation Rules
- Return valid JSON only with: title, executiveSummary, body, disclaimer.
- The body must be valid Markdown.
- Write the entire report in ${isZh ? 'Chinese' : 'English'} only. Do not mix languages.
- ${isZh ? 'Use natural professional Chinese throughout. Technical shorthand such as RSI, MACD, MA, and Bollinger may remain in English.' : 'Use direct professional English throughout.'}
- Prefer short paragraphs and simple explanations over trader jargon.
- Technical indicators, on-chain flow, and chart structure are supporting evidence in explain/assess mode. They may dominate only in act mode.
- Use at most 1-2 compact markdown tables in the whole report.
- Each table should usually have 3-5 rows. Split large tables into smaller ones instead of making one kitchen-sink table.
- Do not generate a large catch-all table with too many fields. Small, high-signal tables are better than exhaustive tables.
- Unless the evidence is genuinely too sparse, do not skip tables entirely.
- Table cells should stay short and factual. Use prose below the table to explain why the numbers or sources matter.
- Prefer tables such as "关键数据快照 / Key Snapshot", "核心驱动与风险 / Drivers and Risks", or "外部证据摘要 / External Evidence Summary" over generic kitchen-sink tables.
- Keep tables narrow: usually 3 columns, sometimes 2, rarely 4. Do not turn them into dashboards.
- Omit rows whose values are unavailable. Do not print null, N/A, or placeholders.
- Keep prices, percentages, and large values consistently formatted.
- Each section must explain what the evidence means, not just list numbers.
- If technical analysis is used, interpret RSI, MACD, MA alignment, Bollinger position, and structure from the supplied numbers.
- If tokenomics is used, interpret inflation, burns, buybacks, and fundraising in supply / dilution terms.
- Do not default to support/resistance, trigger levels, or execution checklists unless responseMode = act.
- If open research is enabled and useful, include a short "### 外部检索补充" / "### Open-Web Evidence" subsection that states which sources changed, confirmed, challenged, or sharpened the conclusion.
- When open research is enabled, do not mention it only in passing. Use 2-4 concrete external items if they materially help answer the user question.
- If open research returns no concrete items, do not tell the reader that the search was empty or degraded. Simply omit the external-evidence section unless limited public evidence materially affects confidence.
- Do not dump raw source URLs inline unless they materially help attribution.
- Use bullets only for execution steps, monitoring triggers, or invalidation conditions.
`.trim();

  const userPrompt = `
## User Question
**"${context.query}"**

${context.taskType ? `**Query Type:** ${context.taskType}${context.focusAreas.length > 0 ? ` | Focus: ${context.focusAreas.join(', ')}` : ''}` : ''}

## Full Conversation Transcript
${
  context.conversationHistoryRaw?.trim()
    ? context.conversationHistoryRaw
    : 'No prior thread history available. Treat the latest user question as the full task.'
}

## Planning Guidance
- **Task Disposition:** ${context.planning.taskDisposition}
- **Primary Intent:** ${context.planning.primaryIntent}
- **Sub Tasks:** ${context.planning.subTasks.join(' | ')}
- **Response Mode:** ${context.planning.responseMode} (${responseModeLabel})
- **Required Modules:** ${
    context.planning.requiredModules.length > 0
      ? context.planning.requiredModules
          .map((item) => `${item.dataType} (${item.priority}) - ${item.reason}`)
          .join(' | ')
      : 'none'
  }
- **Analysis Questions:** ${context.planning.analysisQuestions.join(' | ')}
- **Open Research Enabled:** ${context.planning.openResearch.enabled ? 'yes' : 'no'}
- **Open Research Depth:** ${context.planning.openResearch.depth}
- **Open Research Must Use In Report:** ${context.planning.openResearch.mustUseInReport ? 'yes' : 'no'}
${context.planning.openResearch.topics.length > 0 ? `- **Open Research Topics:** ${context.planning.openResearch.topics.join(' | ')}` : ''}
${context.planning.openResearch.goals.length > 0 ? `- **Open Research Goals:** ${context.planning.openResearch.goals.join(' | ')}` : ''}
${context.planning.openResearch.preferredSources.length > 0 ? `- **Preferred Research Sources:** ${context.planning.openResearch.preferredSources.join(' | ')}` : ''}

## Intent Routing
- **Primary Ask:** ${intentRouting.primaryAsk}
- **Objective:** ${context.objective}
- **Response Mode:** ${context.planning.responseMode}
- **Focus Areas:** ${context.focusAreas.join(', ') || 'none'}
- **Primary Modules To Emphasize:** ${intentRouting.primaryModules.join(' / ')}
- **Secondary Modules To Keep Brief:** ${intentRouting.secondaryModules.join(' / ')}
- **Routing Rule:** Spend most of the report on the primary modules above. Only bring in a secondary module if it changes the answer materially.

## Must Answer Checklist
${context.planning.analysisQuestions.map((question) => `- ${question}`).join('\n')}

## Recent Evidence Feed
### Structured News
${renderRecentNews(context, isZh)}

### Open Research
${renderOpenResearch(context, isZh)}

## Analysis Verdict
- **Verdict:** ${context.decision.verdict}
- **Confidence:** ${(context.decision.confidence * 100).toFixed(0)}%
- **Core Reason:** ${context.decision.reason}
${context.decision.hardBlocks.length > 0 ? `- **Hard Blocks:** ${context.decision.hardBlocks.join(' | ')}` : ''}

## Key Market Snapshot
| ${isZh ? '维度' : 'Dimension'} | ${isZh ? '数值' : 'Value'} | ${isZh ? '信号' : 'Signal'} |
|---|---|---|
| ${isZh ? '价格' : 'Price'} | ${fmtCurrency(context.market.priceUsd)} | ${fmtPct(context.market.change24hPct)} 24h / ${fmtPct(context.market.change7dPct)} 7d |
| ${isZh ? '技术面' : 'Technical'} | ${context.signals.technical} | RSI ${context.signals.technicalDetails.rsi.value !== null ? context.signals.technicalDetails.rsi.value.toFixed(1) : 'N/A'} |
| ${isZh ? '链上' : 'On-chain'} | ${context.signals.onchain} | Netflow signal |
| ${isZh ? '情绪' : 'Sentiment'} | ${context.signals.sentiment} | Score ${context.signals.sentimentDetails.sentimentScore !== null ? context.signals.sentimentDetails.sentimentScore.toFixed(1) : 'N/A'} |
| ${isZh ? '安全' : 'Security'} | ${context.signals.securityRisk} | Risk level |
| ${isZh ? '流动性' : 'Liquidity'} | ${fmtCurrency(context.signals.liquidityUsd)} | ${context.signals.liquidityDetails.rugpullRiskSignal} rugpull risk |
${context.signals.inflationRate !== null ? `| ${isZh ? '通胀率' : 'Inflation'} | ${fmtPct(context.signals.inflationRate)} | Annual rate |` : ''}
| ${isZh ? '风险状态' : 'Risk Status'} | ${context.alerts.level} | ${context.alerts.riskState}${context.alerts.redCount > 0 ? ` | ${context.alerts.redCount} critical alerts` : ''}${context.alerts.yellowCount > 0 ? ` | ${context.alerts.yellowCount} warnings` : ''} |

## Market Anomalies
${(() => {
  const anomalyParts: string[] = [];
  if (context.anomalies.priceVolatility) {
    anomalyParts.push('• **Price:** ' + context.anomalies.priceVolatility);
  }
  if (context.anomalies.socialActivity) {
    anomalyParts.push('• **Social:** ' + context.anomalies.socialActivity);
  }
  if (context.anomalies.onchainFlow) {
    anomalyParts.push('• **On-chain:** ' + context.anomalies.onchainFlow);
  }
  if (context.anomalies.riskEscalation) {
    anomalyParts.push('• **Risk:** ' + context.anomalies.riskEscalation);
  }
  return anomalyParts.length > 0
    ? anomalyParts.join('\n')
    : '• No significant anomalies detected';
})()}

## Technical Structure
| ${isZh ? '指标' : 'Indicator'} | ${isZh ? '数值' : 'Value'} | ${isZh ? '信号' : 'Signal'} |
|---|---|---|
| RSI | ${context.signals.technicalDetails.rsi.value !== null ? context.signals.technicalDetails.rsi.value.toFixed(1) : 'N/A'} | ${context.signals.technicalDetails.rsi.signal} |
| MACD | ${context.signals.technicalDetails.macd.value !== null ? context.signals.technicalDetails.macd.value.toFixed(2) : 'N/A'} (hist: ${context.signals.technicalDetails.macd.histogram !== null ? context.signals.technicalDetails.macd.histogram.toFixed(2) : 'N/A'}) | ${context.signals.technicalDetails.macd.signal} |
| MA7 | ${context.signals.technicalDetails.ma.ma7 !== null ? '$' + context.signals.technicalDetails.ma.ma7.toLocaleString() : 'N/A'} | ${context.signals.technicalDetails.ma.signal} |
| MA25 | ${context.signals.technicalDetails.ma.ma25 !== null ? '$' + context.signals.technicalDetails.ma.ma25.toLocaleString() : 'N/A'} | - |
| MA99 | ${context.signals.technicalDetails.ma.ma99 !== null ? '$' + context.signals.technicalDetails.ma.ma99.toLocaleString() : 'N/A'} | - |
| Bollinger | ${context.signals.technicalDetails.boll.upper !== null ? '$' + context.signals.technicalDetails.boll.upper.toLocaleString() : 'N/A'} / ${context.signals.technicalDetails.boll.middle !== null ? '$' + context.signals.technicalDetails.boll.middle.toLocaleString() : 'N/A'} / ${context.signals.technicalDetails.boll.lower !== null ? '$' + context.signals.technicalDetails.boll.lower.toLocaleString() : 'N/A'} | ${context.signals.technicalDetails.boll.signal} |
| ATR | ${context.signals.technicalDetails.atr !== null ? '$' + context.signals.technicalDetails.atr.toLocaleString() : 'N/A'} | Volatility |
| Swing Levels | ${context.signals.technicalDetails.swingHigh !== null ? '$' + context.signals.technicalDetails.swingHigh.toLocaleString() : 'N/A'} / ${context.signals.technicalDetails.swingLow !== null ? '$' + context.signals.technicalDetails.swingLow.toLocaleString() : 'N/A'} | High / Low |

## Sentiment & On-chain
| ${isZh ? '指标' : 'Metric'} | ${isZh ? '数值' : 'Value'} |
|---|---|
| Social Volume | ${context.signals.sentimentDetails.socialVolume !== null ? context.signals.sentimentDetails.socialVolume.toLocaleString() : 'N/A'} |
| Sentiment | ${context.signals.sentimentDetails.sentimentScore !== null ? context.signals.sentimentDetails.sentimentScore.toFixed(1) : 'N/A'} (Pos: ${context.signals.sentimentDetails.sentimentPositive !== null ? context.signals.sentimentDetails.sentimentPositive.toFixed(1) + '%' : 'N/A'} / Neg: ${context.signals.sentimentDetails.sentimentNegative !== null ? context.signals.sentimentDetails.sentimentNegative.toFixed(1) + '%' : 'N/A'}) |
| Dev Activity | ${context.signals.sentimentDetails.devActivity !== null ? context.signals.sentimentDetails.devActivity.toLocaleString() : 'N/A'} |
| 24h Volume | ${fmtCurrency(context.signals.liquidityDetails.volume24hUsd)} |
| Liquidity Drop 1h | ${context.signals.liquidityDetails.liquidityDrop1hPct !== null ? fmtPct(context.signals.liquidityDetails.liquidityDrop1hPct) : 'N/A'} |
| Price Impact 1k | ${context.signals.liquidityDetails.priceImpact1kPct !== null ? context.signals.liquidityDetails.priceImpact1kPct.toFixed(2) + '%' : 'N/A'} |

## Tokenomics Health
${(() => {
  const tk = context.tokenomics;
  const hasBurns =
    tk.burns.totalBurnAmount !== null || tk.burns.recentBurnCount > 0;
  const hasBuybacks =
    tk.buybacks.totalBuybackAmount !== null ||
    tk.buybacks.recentBuybackCount > 0;
  const hasFundraising =
    tk.fundraising.totalRaised !== null || tk.fundraising.roundCount > 0;

  if (!hasBurns && !hasBuybacks && !hasFundraising) {
    return '• Tokenomics details (burns, buybacks, fundraising) not available for this asset';
  }

  const parts: string[] = [];
  if (hasBurns) {
    const burnInfo =
      tk.burns.totalBurnAmount !== null
        ? tk.burns.totalBurnAmount.toLocaleString() + ' tokens burned'
        : 'Available';
    const burnSummary = tk.burns.burnSummary
      ? ' — ' + tk.burns.burnSummary
      : '';
    parts.push(
      '**Burns:** ' +
        burnInfo +
        ', ' +
        tk.burns.recentBurnCount +
        ' recent events' +
        burnSummary,
    );
  }
  if (hasBuybacks) {
    const buybackInfo =
      tk.buybacks.totalBuybackAmount !== null
        ? tk.buybacks.totalBuybackAmount.toLocaleString() +
          ' tokens repurchased'
        : 'Available';
    const buybackSummary = tk.buybacks.buybackSummary
      ? ' — ' + tk.buybacks.buybackSummary
      : '';
    parts.push(
      '**Buybacks:** ' +
        buybackInfo +
        ', ' +
        tk.buybacks.recentBuybackCount +
        ' recent events' +
        buybackSummary,
    );
  }
  if (hasFundraising) {
    const raiseInfo =
      tk.fundraising.totalRaised !== null
        ? '$' + tk.fundraising.totalRaised.toLocaleString() + ' raised'
        : 'Available';
    const raiseSummary = tk.fundraising.fundraisingSummary
      ? ' — ' + tk.fundraising.fundraisingSummary
      : '';
    parts.push(
      '**Fundraising:** ' +
        raiseInfo +
        ', ' +
        tk.fundraising.roundCount +
        ' rounds' +
        raiseSummary,
    );
  }
  return parts.join('\n');
})()}

${
  context.signals.projectName ||
  context.signals.projectOneLiner ||
  context.signals.fundamentalsTags.length > 0
    ? `## Project Profile
${context.signals.projectName ? `**${context.signals.projectName}** (${context.target.symbol})` : `**${context.target.symbol}**`}
${context.signals.projectOneLiner ? `• ${context.signals.projectOneLiner}` : ''}
${context.signals.fundamentalsTags.length > 0 ? `• Tags: ${context.signals.fundamentalsTags.join(', ')}` : ''}`
    : ''
}

## Trade & Risk Setup
${
  context.decision.tradingStrategy
    ? `
**Entry:** ${fmtCurrency(context.decision.tradingStrategy.entryPrice)} | **Zone:** ${context.decision.tradingStrategy.entryZone ?? 'N/A'} | **Risk/Reward:** ${context.decision.tradingStrategy.riskRewardRatio ?? 'N/A'}
**Stop Loss:** ${context.decision.tradingStrategy.stopLoss ? `${fmtCurrency(context.decision.tradingStrategy.stopLoss.price)} (${context.decision.tradingStrategy.stopLoss.label})` : 'N/A'}
${context.decision.tradingStrategy.takeProfitLevels.length > 0 ? `**Take Profit:** ${context.decision.tradingStrategy.takeProfitLevels.map((tp) => `${fmtCurrency(tp.price)} (${tp.label}, ${tp.pctFromEntry >= 0 ? '+' : ''}${tp.pctFromEntry}%)`).join(' / ')}` : ''}
${context.decision.tradingStrategy.supportLevels.length > 0 ? `**Support:** ${context.decision.tradingStrategy.supportLevels.map((s) => s.label).join(' / ')}` : ''}
${context.decision.tradingStrategy.resistanceLevels.length > 0 ? `**Resistance:** ${context.decision.tradingStrategy.resistanceLevels.map((r) => r.label).join(' / ')}` : ''}
${context.decision.tradingStrategy.note ? `*Note: ${context.decision.tradingStrategy.note}*` : ''}
`
    : `**Buy Zone:** ${context.decision.buyZone ?? 'N/A'} | **Sell Zone:** ${context.decision.sellZone ?? 'N/A'}
${context.decision.evidence.length > 0 ? `**Supporting Evidence:** ${context.decision.evidence.slice(0, 3).join(' | ')}` : ''}`
}

## Writing Task
Write a complete report for ${context.target.symbol}, not a short summary.

The user asked: "${context.query}"

Your report must:
- Directly answer the user's real question first.
- Make sure every explicit user sub-question is answered, even if briefly.
- Be driven by the primary modules above instead of a fixed template.
- Lead with the conclusion, then support it with the most relevant evidence.
- Keep the explanation readable for non-specialists without becoming shallow.
- If there are enough usable metrics, add a compact "关键数据快照" / "Key Snapshot" table near the top.
- If external evidence materially affects the answer, add a second compact table that summarizes the most important external findings instead of leaving them scattered in prose.
- Use tables to present facts; use the paragraphs below them to explain why those facts matter.
- If the user asks about what changed, why price moved, what the biggest risk is, or whether the move is fundamentals vs sentiment, the report should visibly use external evidence instead of relying only on internal structured metrics.
- Surface the key quantitative state early only when it helps answer the question.
- Explain conflicts between signals and state which evidence you weight more heavily.
- Use sentiment, liquidity, on-chain, fundamentals, and tokenomics only when they add explanatory value.
- When open research provides useful evidence, show how it changed, confirmed, or limited the conclusion.
- Include what matters now, what to watch next, and what would invalidate the thesis.
- In explain mode, focus on understanding, not advice.
- In assess mode, focus on judgment and conditions, not trade execution.
- In act mode, concrete execution framing is allowed.
- Avoid mentioning or comparing any other asset.
- Avoid chatbot tone, compliance-memo tone, and unsupported narrative filler.
- Keep table cells clean: raw values or short labels only, never free-form prose.
`.trim();

  return {
    systemPrompt,
    userPrompt,
  };
}

type ReportModuleKey =
  | 'recent'
  | 'market'
  | 'onchain'
  | 'sentiment'
  | 'technical'
  | 'fundamentals'
  | 'tokenomics'
  | 'trade'
  | 'risk';

function buildIntentRouting(
  context: ReportPromptContext,
  isZh: boolean,
): {
  primaryAsk: string;
  primaryModules: string[];
  secondaryModules: string[];
} {
  const modeDefaults: Record<PlanOutput['responseMode'], ReportModuleKey[]> = {
    explain: ['recent', 'fundamentals', 'sentiment', 'market'],
    assess: ['market', 'fundamentals', 'tokenomics', 'risk'],
    act: ['technical', 'market', 'trade', 'risk'],
  };

  const focusModuleMap: Partial<
    Record<ReportPromptContext['focusAreas'][number], ReportModuleKey>
  > = {
    price_action: 'market',
    technical_indicators: 'technical',
    onchain_flow: 'onchain',
    security_risk: 'risk',
    liquidity_quality: 'onchain',
    tokenomics: 'tokenomics',
    project_fundamentals: 'fundamentals',
    news_events: 'recent',
  };

  const labels: Record<ReportModuleKey, string> = isZh
    ? {
        recent: '近期动态',
        market: '市场情况',
        onchain: '链上与流动性',
        sentiment: '情绪与资金面',
        technical: '技术分析',
        fundamentals: '基本面',
        tokenomics: '代币经济学',
        trade: '交易计划',
        risk: '风险提示',
      }
    : {
        recent: 'Recent Changes',
        market: 'Market State',
        onchain: 'On-chain and Liquidity',
        sentiment: 'Sentiment and Positioning',
        technical: 'Technical Structure',
        fundamentals: 'Fundamentals',
        tokenomics: 'Tokenomics',
        trade: 'Trade Setup',
        risk: 'Risk Warnings',
      };

  const primaryAskMap: Record<PlanOutput['responseMode'], string> = isZh
    ? {
        explain: '先直接回答用户想弄明白的事情，再解释最近发生了什么、主要驱动是什么、哪些地方还不确定。',
        assess:
          '先给出当前值不值得关注或投资的判断，再解释支撑理由、主要风险和应该如何理解这个投资命题。',
        act:
          '先回答现在该不该动手，以及哪些位置、条件和信号最关键。',
      }
    : {
        explain:
          'Answer the user’s core question first, then explain what changed, what is driving it, and what remains uncertain.',
        assess:
          'Give the investment judgment first, then explain the supporting reasons, biggest risks, and how to interpret the thesis now.',
        act:
          'Answer whether action is warranted now and which levels, conditions, and signals matter most.',
      };

  const chosen: ReportModuleKey[] = [];
  for (const key of modeDefaults[context.planning.responseMode] ?? []) {
    if (!chosen.includes(key)) {
      chosen.push(key);
    }
  }
  for (const area of context.focusAreas) {
    const key = focusModuleMap[area];
    if (key && !chosen.includes(key)) {
      chosen.push(key);
    }
  }

  const primaryModules = chosen.slice(0, 4);
  const allModules: ReportModuleKey[] = [
    'recent',
    'market',
    'onchain',
    'sentiment',
    'technical',
    'fundamentals',
    'tokenomics',
    'trade',
    'risk',
  ];
  const secondaryModules = allModules.filter(
    (key) => !primaryModules.includes(key),
  );

  return {
    primaryAsk: primaryAskMap[context.planning.responseMode],
    primaryModules: primaryModules.map((key) => labels[key]),
    secondaryModules: secondaryModules.map((key) => labels[key]),
  };
}

function renderRecentNews(context: ReportPromptContext, isZh: boolean): string {
  if (context.recentEvidence.news.length === 0) {
    return isZh
      ? '• 当前没有结构化新闻条目。'
      : '• No structured news items are available.';
  }

  return context.recentEvidence.news
    .map(
      (item) =>
        `- [${item.source}] ${item.publishedAt} | ${item.category} | ${item.title} | relevance=${item.relevanceScore.toFixed(2)} | ${item.url}`,
    )
    .join('\n');
}

function renderOpenResearch(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  if (!context.recentEvidence.openResearch.enabled) {
    return isZh
      ? '• 本次规划未开启开放检索。'
      : '• Open research was not enabled for this plan.';
  }

  const parts: string[] = [];
  if (context.recentEvidence.openResearch.takeaways.length > 0) {
    parts.push(
      `Takeaways: ${context.recentEvidence.openResearch.takeaways.join(' | ')}`,
    );
  }

  if (context.recentEvidence.openResearch.items.length === 0) {
    const contextLine =
      context.recentEvidence.openResearch.topics.length > 0
        ? isZh
          ? `Focus: ${context.recentEvidence.openResearch.topics.join(' | ')}`
          : `Focus: ${context.recentEvidence.openResearch.topics.join(' | ')}`
        : '';
    return [parts.join('\n'), contextLine].filter(Boolean).join('\n');
  }

  parts.push(
    ...context.recentEvidence.openResearch.items.map(
      (item) =>
        `- [${item.source}] ${item.topic} | ${item.title}${item.snippet ? ` | ${item.snippet}` : ''} | ${item.url}`,
    ),
  );
  return parts.join('\n');
}

function fmtCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  if (Math.abs(value) < 1 && value !== 0) {
    return `$${value.toFixed(6)}`;
  }
  return `$${value.toFixed(2)}`;
}

function fmtPct(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

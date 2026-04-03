import type {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
} from '../../../data/contracts/workflow-contracts';
import type { AlertsSnapshot } from '../../../data/contracts/analyze-contracts';
import type { LiquidityVenueSnapshot } from '../../../data/contracts/analyze-contracts';
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
    marketCapUsd: number | null;
    fdvUsd: number | null;
    circulatingSupply: number | null;
    maxSupply: number | null;
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
      topVenues: LiquidityVenueSnapshot[];
      venueCount: number | null;
    };
    inflationRate: number | null;
    projectName: string | null;
    projectOneLiner: string | null;
    fundamentalsTags: string[];
  };
  fundamentals: {
    totalFundingUsd: number | null;
    rtScore: number | null;
    tvlScore: number | null;
    investorCount: number;
    topInvestors: string[];
    fundraisingCount: number;
    latestRound: {
      round: string | null;
      amountUsd: number | null;
      publishedAt: string | null;
      investors: string[];
    } | null;
    ecosystemCount: number;
    ecosystemHighlights: string[];
    socialFollowers: number | null;
    hotIndexScore: number | null;
    socialLinks: string[];
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
  const tableBlueprint = buildTableBlueprint(context, isZh);
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
3. For explain or assess mode, usually use 4-6 relevant modules when evidence is available. For act mode, 2-4 modules is usually enough.
4. Let the chosen primary modules dominate the report, but do not drop high-signal supporting modules merely to keep the report short.
5. Mention secondary modules whenever they materially sharpen, challenge, or constrain the conclusion.

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
- In explain or assess mode, the report should usually have enough substance to feel like a real research note, not a short memo.
- Unless evidence is truly sparse, explain or assess mode should usually include a fuller research structure.
- In explain or assess mode, default to 3-4 compact tables. Three is the minimum target when evidence exists; four is preferred when the question naturally breaks into multiple sub-questions.
- In explain or assess mode, each section must do a different job. Do not restate the same conclusion in multiple sections with slightly different wording.
- In explain or assess mode, do not stop at naming the judgment. Expand it into a short cause-and-effect chain so the reader can see why that judgment holds.
- For explain or assess mode with sufficient evidence, usually include these main sections in this order:
  1. 关键回答 / Core Answer
  2. 关键数据快照 / Key Snapshot
  3. 外部证据摘要 or 核心驱动与风险 / External Evidence Summary or Drivers and Risks
  4. 市场情况 / Market State
  5. 基本面 / Fundamentals
  6. 情绪与资金面 / Sentiment and Positioning
  7. 技术与结构 / Technical Structure
  8. 风险提示 / Risk Warnings
  9. 接下来观察什么 / What To Watch Next
- If one of the sections above is genuinely unsupported by evidence, omit it explicitly and let the nearby sections absorb the explanation. Do not compress the whole report just because one section is weak.
- The body must begin with a single "# " title line.
- Use "##" for main sections and "###" for sub-sections when needed.
- Never use numbered headings.
- When the supplied evidence contains at least 3 usable structured metrics, include 1 compact markdown table near the top. Do not default to a pure long-form essay.
- That first table should usually be "关键数据快照" / "Key Snapshot".
- If open research or news evidence materially affects the answer, prefer a second compact table instead of burying those points in prose.
- In explain or assess mode, tables should be the main information layer and prose should mainly interpret the tables.
- In explain or assess mode, if the report makes 2 or more material judgments, include a compact "关键判断验证状态 / Validation Status" table that distinguishes what is verified, directionally supported, or still weakly confirmed.
- Keep section boundaries clean:
  - "关键回答 / Core Answer": directly answer the user question in the shortest clear form.
  - "关键数据快照 / Key Snapshot": present the current state numerically, without repeating the full thesis.
  - Evidence tables: show the facts that support or challenge the answer.
  - Later prose sections: explain implication, conflict, risk, and what to watch next.
- Choose the second table by question type:
  - recent developments / ecosystem progress -> "外部证据摘要" / "External Evidence Summary"
  - drivers / biggest risks / investability -> "核心驱动与风险" / "Drivers and Risks"
  - fundamentals vs sentiment -> "基本面 vs 情绪证据" / "Fundamentals vs Sentiment"
- For explain or assess mode, prefer several small tables over one large table.
- Match the table set to the question type. Do not reuse the same table pattern for every query.
- If the user asks multiple explicit questions, split them across separate tables whenever that improves scanability.
- If the user asks multiple explicit questions, give each one its own sub-section or dedicated block instead of answering all of them in one compressed paragraph.
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
- In explain or assess mode, actively use concrete structured data from market, technical, sentiment, liquidity, fundamentals, tokenomics, and on-chain whenever those modules contain usable information.
- Do not answer with only a high-level conclusion if the supplied context includes meaningful metrics, snapshots, or external evidence that can make the report more specific.
- When enough usable evidence exists, the report should reference multiple concrete structured metrics and multiple concrete external evidence items rather than staying abstract.
- If a major structured module is available and relevant, explain why it matters; do not silently ignore it for brevity.
- If liquidity contains top venues or pool-level detail, cite at least 1-2 concrete pair or venue facts instead of saying only "liquidity is strong/weak".
- If fundamentals contain investors, fundraising, ecosystem deployment, or social data, cite at least 1 concrete fact from those fields when they materially support the thesis.
- Do not repeat the same evidence item in more than one main section unless the repetition is necessary to resolve a conflict between signals.
- If the same fact appears in a table, the paragraph below should explain its meaning, not restate the fact sentence-by-sentence.
- For every major conclusion, explain three things when evidence allows:
  1. what facts support it,
  2. why those facts are more convincing than the closest competing explanation,
  3. what future evidence would invalidate or materially weaken that conclusion.
- If the report says a move is not driven by X, explain what evidence would have been expected if X were truly the main driver.
- Distinguish between verified evidence, directional but incomplete evidence, and missing verification. Do not present all evidence with the same certainty level.

## Presentation Rules
- Return valid JSON only with: title, executiveSummary, body, disclaimer.
- The body must be valid Markdown.
- Write the entire report in ${isZh ? 'Chinese' : 'English'} only. Do not mix languages.
- ${isZh ? 'Use natural professional Chinese throughout. Technical shorthand such as RSI, MACD, MA, and Bollinger may remain in English.' : 'Use direct professional English throughout.'}
- Prefer medium-length clear paragraphs and simple explanations over trader jargon.
- Technical indicators, on-chain flow, and chart structure are supporting evidence in explain/assess mode. They may dominate only in act mode.
- Use multiple compact markdown tables whenever they help readability in explain/assess mode.
- When structured and external evidence are both available, usually include at least 2 tables.
- If the evidence naturally fits 3 or more small tables, that is allowed. Do not force everything into only 1-2 tables.
- In explain or assess mode, the default target is 3-4 compact tables, not 1-2.
- Each table should usually have 3-5 rows. Split large tables into smaller ones instead of making one kitchen-sink table.
- Do not generate a large catch-all table with too many fields. Small, high-signal tables are better than exhaustive tables.
- Unless the evidence is genuinely too sparse, do not skip tables entirely.
- Table cells should stay short and factual. Use prose below the table to explain why the numbers or sources matter.
- Prefer tables such as "关键数据快照 / Key Snapshot", "核心驱动与风险 / Drivers and Risks", or "外部证据摘要 / External Evidence Summary" over generic kitchen-sink tables.
- Keep tables narrow: usually 3 columns, sometimes 2, rarely 4. Do not turn them into dashboards.
- Omit rows whose values are unavailable. Do not print null, N/A, or placeholders.
- Keep prices, percentages, and large values consistently formatted.
- Each section must explain what the evidence means, not just list numbers.
- Keep paragraphs short and single-purpose. One paragraph should usually explain one idea only.
- If technical analysis is used, interpret RSI, MACD, MA alignment, Bollinger position, and structure from the supplied numbers.
- If tokenomics is used, interpret inflation, burns, buybacks, and fundraising in supply / dilution terms.
- Do not default to support/resistance, trigger levels, or execution checklists unless responseMode = act.
- If open research is enabled and useful, include a short "### 外部检索补充" / "### Open-Web Evidence" subsection that states which sources changed, confirmed, challenged, or sharpened the conclusion.
- When open research is enabled, do not mention it only in passing. Use 2-4 concrete external items if they materially help answer the user question.
- If open research returns no concrete items, do not tell the reader that the search was empty or degraded. Simply omit the external-evidence section unless limited public evidence materially affects confidence.
- Do not dump raw source URLs inline unless they materially help attribution.
- Prefer naming the exact venue, pool, market, investor, round, or ecosystem connection when those fields are supplied. Avoid generic wording that leaves structured evidence unused.
- Use bullets only for execution steps, monitoring triggers, or invalidation conditions.
- In explain or assess mode, do not end the report immediately after the core answer. Continue into evidence interpretation, risks, and what to watch if the data supports it.
- In explain or assess mode, prioritize completeness of reasoning over brevity when the supplied evidence is rich.
- In explain or assess mode, avoid a wall of prose. Alternate between compact tables and short explanatory paragraphs.
- Remove redundancy aggressively. If a point has already been made clearly, advance the argument instead of paraphrasing it again.
- For key tables, the prose below should usually have at least two layers:
  - first layer: explain what the table shows,
  - second layer: explain why that matters for the user question.
- When a question naturally invites an alternative explanation, include a short "why not the other explanation" discussion instead of only defending the chosen thesis.
- When evidence is incomplete, say what is missing in operational terms such as adoption numbers, TVL change, usage change, disclosed customer names, or on-chain confirmation.
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

## Table Blueprint
${tableBlueprint}

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
${context.market.marketCapUsd !== null ? `| ${isZh ? '市值' : 'Market Cap'} | ${fmtCurrency(context.market.marketCapUsd)} | ${context.market.marketCapRank !== null ? `Rank #${context.market.marketCapRank}` : (isZh ? '规模参考' : 'Size context')} |` : ''}
${context.market.fdvUsd !== null ? `| FDV | ${fmtCurrency(context.market.fdvUsd)} | ${context.market.circulatingSupply !== null && context.market.maxSupply !== null && context.market.maxSupply > 0 ? `${((context.market.circulatingSupply / context.market.maxSupply) * 100).toFixed(1)}% ${isZh ? '流通' : 'circulating'}` : (isZh ? '供给参考' : 'Supply context')} |` : ''}
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

## Liquidity Venue Detail
${renderLiquidityVenues(context, isZh)}

## Fundamentals Detail
${renderFundamentalsDetail(context, isZh)}

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
- If the user asked 2 or more explicit questions, do not merge them into one compressed answer block. Give each question its own mini-answer or sub-section.
- Be driven by the primary modules above instead of a fixed template.
- Lead with the conclusion, then support it with the most relevant evidence.
- Keep the explanation readable for non-specialists without becoming shallow or overly compressed.
- In explain or assess mode, default to 3-4 compact tables unless evidence is genuinely sparse.
- If there are enough usable metrics, add a compact "关键数据快照" / "Key Snapshot" table near the top.
- Use the supplied table blueprint unless the evidence clearly demands a better variant.
- Use tables to present facts first; use the paragraphs below them to explain why those facts matter.
- Prefer several small, question-specific tables over one generic summary table.
- Keep the report structurally clean: each section should add new information, not repackage the same point.
- If the user asks about what changed, why price moved, what the biggest risk is, or whether the move is fundamentals vs sentiment, the report should visibly use external evidence instead of relying only on internal structured metrics.
- Surface the key quantitative state early only when it helps answer the question.
- Explain conflicts between signals and state which evidence you weight more heavily.
- In explain or assess mode, if sentiment, liquidity, on-chain, fundamentals, and tokenomics contain useful information, actively use them instead of leaving them unused.
- When open research provides useful evidence, show how it changed, confirmed, or limited the conclusion.
- Include what matters now, what to watch next, and what would invalidate the thesis.
- For each major conclusion, show the reasoning path instead of jumping from data to answer in one sentence.
- If you reject an obvious alternative interpretation, say why it is weaker than the main interpretation.
- In explain mode, focus on understanding, not advice.
- In assess mode, focus on judgment and conditions, not trade execution.
- In act mode, concrete execution framing is allowed.
- When the report contains several sub-questions, let each major table answer one sub-question cleanly.
- Keep paragraphs short and anchored to the table directly above them.
- Do not let a key table be followed by only one thin summary sentence when the evidence is rich. Expand the implication and the boundary conditions.
- Do not repeat the same conclusion in the Core Answer, later body paragraphs, and the Risk Warnings section. State it once clearly, then move on to support, caveats, or monitoring points.
- Avoid mentioning or comparing any other asset.
- Avoid chatbot tone, compliance-memo tone, and unsupported narrative filler.
- Keep table cells clean: raw values or short labels only, never free-form prose.
- If evidence is sufficient, the body should usually feel medium-to-long rather than memo-length.
- In explain or assess mode with sufficient evidence, usually use at least 4 modules and multiple concrete external items.
- Allow the report to use 2, 3, or more compact tables when that improves clarity.
- Do not collapse market, fundamentals, sentiment, technical, and risk into one short section if they each contain meaningful evidence.
- Do not stop after a brief answer paragraph if the prompt contains enough data to build a fuller report.
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

function buildTableBlueprint(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const profile = detectTableProfile(context);

  if (profile === 'fundamentals_vs_sentiment') {
    return isZh
      ? [
          '- 默认使用 4 张小表；若证据略少，至少保留前 3 张。',
          '- 表 1：`关键数据快照`。放价格、涨跌幅、RSI、成交量、情绪分等基础状态。',
          '- 表 2：`基本面证据`。放开发、采用、产品发布、链上使用、机构采用等可验证事实。',
          '- 表 3：`情绪与资金面证据`。放社交热度、情绪分、资金流、新闻催化、短线投机信号。',
          '- 表 4：`基本面 vs 情绪结论对照`。用“证据 / 指向 / 结论”三列，直接判断更偏哪一边。',
          '- 额外补一张：`关键判断验证状态`。列出哪些判断已被链上/官方/外部证据验证，哪些仍只是方向性判断。',
          '- 每张表下面用 1-2 段短文解释，不要先写大段综述再补表。',
          '- 在对照表之后，要明确展开三件事：为什么不像基本面驱动、为什么也不像纯情绪驱动、剩下更像什么解释。',
        ].join('\n')
      : [
          '- Default to 4 compact tables; if evidence is lighter, keep at least the first 3.',
          '- Table 1: `Key Snapshot` with price, returns, RSI, volume, sentiment score, and current state.',
          '- Table 2: `Fundamentals Evidence` with adoption, launches, developer activity, usage, and institution-related facts.',
          '- Table 3: `Sentiment and Positioning Evidence` with social activity, sentiment, flows, catalysts, and speculative signals.',
          '- Table 4: `Fundamentals vs Sentiment Verdict` using short columns such as evidence / direction / conclusion.',
          '- Add one more compact table: `Validation Status`, showing which judgments are verified, directionally supported, or still weakly confirmed.',
          '- After each table, use 1-2 short paragraphs to interpret it instead of front-loading a long essay.',
          '- After the comparison table, explicitly explain why the move is not mainly fundamentals, why it is not mainly sentiment either when applicable, and what the more plausible residual explanation is.',
        ].join('\n');
  }

  if (profile === 'drivers_risks_investability') {
    return isZh
      ? [
          '- 默认使用 4 张小表；若证据一般，可压缩为前 3 张。',
          '- 表 1：`关键数据快照`。放价格、趋势、流动性、链上流向、风险等级等。',
          '- 表 2：`上涨驱动因素`。把每个驱动拆成“驱动 / 证据 / 持续性判断”。',
          '- 表 3：`主要风险`。把每个风险拆成“风险 / 当前迹象 / 影响路径”。',
          '- 表 4：`当前投资判断`。用“支持投资 / 不支持投资 / 需要新增验证”三列，直接回答“现在适不适合”。',
          '- 额外补一张：`关键判断验证状态`。说明驱动、风险、投资结论分别属于已验证、部分验证还是待验证。',
          '- 解释段落围绕每张表展开，不要把驱动、风险、投资判断混在一段里。',
          '- 三个核心问题都要单独展开：为什么驱动不够硬、为什么这个风险最大、为什么现在不适合或适合投资，以及需要什么变化才会改判。',
        ].join('\n')
      : [
          '- Default to 4 compact tables; if evidence is middling, compress to the first 3 only.',
          '- Table 1: `Key Snapshot` with price, trend, liquidity, on-chain flow, and current risk state.',
          '- Table 2: `Upside Drivers` with driver / evidence / durability.',
          '- Table 3: `Major Risks` with risk / current signs / impact path.',
          '- Table 4: `Current Investment Judgment` with columns such as supports investing / does not support investing / what still needs confirmation.',
          '- Add one more compact table: `Validation Status`, clarifying whether the driver, risk, and investability judgments are verified, partially verified, or still pending confirmation.',
          '- Keep prose tied to each table. Do not blend drivers, risks, and investability into one dense block.',
          '- Expand the three user jobs separately: why the upside drivers are not yet strong enough, why the named biggest risk matters more than other risks, and why the asset is or is not investable right now plus what would need to change.',
        ].join('\n');
  }

  if (profile === 'relationship_dependency') {
    return isZh
      ? [
          '- 默认使用 4 张小表。',
          '- 表 1：`关系定义`。说明这是生态关系、业务关系、流动性关系、叙事关系还是价值捕获关系。',
          '- 表 2：`传导机制`。列出这层关系如何传导到价格、需求、用户、流动性或估值想象。',
          '- 表 3：`证据与反证`。同时列出支持关系成立的证据，以及削弱这层关系的反证。',
          '- 表 4：`关键判断验证状态`。列出哪些关系已经被验证，哪些仍停留在叙事层，哪些缺少关键数据。',
          '- 正文必须明确解释：关系到底强不强、为什么不是简单同步上涨关系、什么条件下这层关系会减弱或失效。',
        ].join('\n')
      : [
          '- Default to 4 compact tables.',
          '- Table 1: `Relationship Definition`, clarifying whether the linkage is ecosystem, business, liquidity, narrative, or value-capture based.',
          '- Table 2: `Transmission Mechanism`, explaining how the linkage could transmit into price, demand, users, liquidity, or valuation.',
          '- Table 3: `Evidence and Counter-Evidence`, showing what supports the relationship and what weakens it.',
          '- Table 4: `Validation Status`, separating verified linkage, narrative-only linkage, and linkage still missing key data.',
          '- The prose must explain how strong the linkage really is, why it is not just simple price co-movement, and under what conditions the linkage would weaken or break.',
        ].join('\n');
  }

  if (profile === 'recent_and_l2_progress') {
    return isZh
      ? [
          '- 默认使用 4 张小表；若外部证据不够，至少保留前 3 张。',
          '- 表 1：`近期动态时间线`。按时间列出最近关键事件、发布、升级、基金会动作。',
          '- 表 2：`L2进展状态`。按项目或主题列出“进展点 / 当前状态 / 是否有量化验证”。',
          '- 表 3：`关键数据快照`。放价格、成交量、链上/情绪信号，用来说明市场是否已反映这些变化。',
          '- 表 4：`待验证事项`。列出哪些L2进展已经落地，哪些仍停留在叙事或战略表述。',
          '- 正文重点解释“发生了什么、哪些是实质进展、哪些只是叙事”。',
          '- 要明确拆开讲：哪些是已经落地的真实进展，哪些只是战略表述，以及这些变化为什么还没有明显传导到价格。',
        ].join('\n')
      : [
          '- Default to 4 compact tables; if external evidence is thin, keep at least the first 3.',
          '- Table 1: `Recent Developments Timeline` listing the latest launches, upgrades, foundation actions, and ecosystem events.',
          '- Table 2: `L2 Progress Status` with progress item / current status / whether it has quantitative proof.',
          '- Table 3: `Key Snapshot` showing price, volume, and major on-chain or sentiment signals to test whether the market has priced it in.',
          '- Table 4: `What Still Needs Validation` separating shipped progress from narrative-only claims.',
          '- The prose should mainly clarify what actually changed, what is substantive, and what is still just narrative.',
          '- Explicitly separate real shipped progress, strategic messaging or governance framing, and why those changes have or have not translated into ETH price action.',
        ].join('\n');
  }

  if (context.planning.responseMode === 'assess') {
    return isZh
      ? [
          '- 默认使用 3-4 张小表。',
          '- 表 1：`关键数据快照`。',
          '- 表 2：`核心驱动与风险`。',
          '- 表 3：`信号交叉验证`，对照基本面、情绪、链上、技术是否一致。',
          '- 表 4：`接下来观察什么`，如果证据足够则补充。',
          '- 先让表回答问题，再用短段落解释。避免长段纯文字。',
        ].join('\n')
      : [
          '- Default to 3-4 compact tables.',
          '- Table 1: `Key Snapshot`.',
          '- Table 2: `Drivers and Risks`.',
          '- Table 3: `Signal Cross-check` across fundamentals, sentiment, on-chain, and technical structure.',
          '- Table 4: `What To Watch Next` when evidence supports it.',
          '- Let the tables answer first, then use short paragraphs to interpret them. Avoid long pure-prose blocks.',
        ].join('\n');
  }

  return isZh
    ? [
        '- 默认使用 3-4 张小表。',
        '- 表 1：`关键数据快照`。',
        '- 表 2：`外部证据摘要`。',
        '- 表 3：`信号对照表`，把市场、基本面、情绪、链上中最相关的信号并列。',
        '- 表 4：`接下来观察什么`，如果证据足够则补充。',
        '- 表格是主信息层，正文只负责解释表格中的关键冲突与结论。',
      ].join('\n')
    : [
        '- Default to 3-4 compact tables.',
        '- Table 1: `Key Snapshot`.',
        '- Table 2: `External Evidence Summary`.',
        '- Table 3: `Signal Cross-check`, placing the most relevant market, fundamentals, sentiment, and on-chain signals side by side.',
        '- Table 4: `What To Watch Next` when evidence supports it.',
        '- Tables are the primary information layer; prose should mainly explain the conflicts and conclusions inside those tables.',
      ].join('\n');
}

function detectTableProfile(
  context: ReportPromptContext,
): 'fundamentals_vs_sentiment' | 'drivers_risks_investability' | 'relationship_dependency' | 'recent_and_l2_progress' | 'generic' {
  const query = context.query.toLowerCase();
  const primaryIntent = context.planning.primaryIntent.toLowerCase();
  const focusAreas = new Set(context.focusAreas);

  const fundamentalsVsSentiment =
    /基本面/.test(context.query) &&
    /情绪|情绪面|sentiment/.test(context.query);
  if (
    fundamentalsVsSentiment ||
    (focusAreas.has('project_fundamentals') &&
      (focusAreas.has('news_events') || focusAreas.has('price_action')) &&
      /sentiment|speculation|emotion/.test(query))
  ) {
    return 'fundamentals_vs_sentiment';
  }

  if (
    context.objective === 'relationship_analysis' ||
    /关系|关联|联动|绑定|依赖|价值捕获|relationship|dependency|linked to|value capture|业务之间|生态之间/.test(
      context.query,
    )
  ) {
    return 'relationship_dependency';
  }

  if (
    /驱动|风险|适合投资|值不值得|能买吗|可以买|invest|investment|risk|driver/.test(
      context.query,
    ) ||
    /投资|风险|判断|invest|risk/.test(primaryIntent)
  ) {
    return 'drivers_risks_investability';
  }

  if (
    /最近|新动向|进展|升级|生态|l2|layer 2|rollup/.test(query) ||
    (focusAreas.has('news_events') &&
      (query.includes('l2') || query.includes('layer 2')))
  ) {
    return 'recent_and_l2_progress';
  }

  return 'generic';
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

function renderLiquidityVenues(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const venues = context.signals.liquidityDetails.topVenues.slice(0, 4);
  if (venues.length === 0) {
    return isZh
      ? '• 当前没有更细的池子/市场结构数据。'
      : '• No richer pool or market structure data is available.';
  }

  return [
    `| ${isZh ? '市场/池子' : 'Venue'} | ${isZh ? '交易对' : 'Pair'} | ${isZh ? '流动性/成交' : 'Liquidity / Volume'} |`,
    '|---|---|---|',
    ...venues.map((venue) => {
      const valueParts: string[] = [];
      if (venue.liquidityUsd !== null) {
        valueParts.push(fmtCurrency(venue.liquidityUsd));
      }
      if (venue.volume24hUsd !== null) {
        valueParts.push(`24h ${fmtCurrency(venue.volume24hUsd)}`);
      }
      if (venue.marketSharePct !== null) {
        valueParts.push(`${venue.marketSharePct.toFixed(1)}% share`);
      }
      return `| ${venue.venueName ?? (venue.venueType === 'dex_pool' ? 'DEX Pool' : 'CEX Market')} | ${venue.pairLabel} | ${valueParts.join(' / ')} |`;
    }),
  ].join('\n');
}

function renderFundamentalsDetail(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const rows: Array<[string, string, string]> = [];
  if (context.fundamentals.totalFundingUsd !== null) {
    rows.push([
      isZh ? '累计融资' : 'Funding',
      fmtCurrency(context.fundamentals.totalFundingUsd),
      isZh ? '历史资本支持' : 'Historical capital backing',
    ]);
  }
  if (context.fundamentals.topInvestors.length > 0) {
    rows.push([
      isZh ? '投资方' : 'Investors',
      context.fundamentals.topInvestors.slice(0, 3).join(', '),
      isZh ? `共 ${context.fundamentals.investorCount} 家` : `${context.fundamentals.investorCount} investors`,
    ]);
  }
  if (context.fundamentals.latestRound) {
    rows.push([
      isZh ? '最近融资' : 'Latest Round',
      [
        context.fundamentals.latestRound.round,
        context.fundamentals.latestRound.amountUsd !== null
          ? fmtCurrency(context.fundamentals.latestRound.amountUsd)
          : null,
      ]
        .filter(Boolean)
        .join(' / '),
      context.fundamentals.latestRound.investors.length > 0
        ? context.fundamentals.latestRound.investors.slice(0, 2).join(', ')
        : isZh
          ? '无披露投资方'
          : 'No named investors',
    ]);
  }
  if (context.fundamentals.ecosystemHighlights.length > 0) {
    rows.push([
      isZh ? '生态触点' : 'Ecosystem',
      context.fundamentals.ecosystemHighlights.slice(0, 3).join(', '),
      isZh ? `共 ${context.fundamentals.ecosystemCount} 个方向` : `${context.fundamentals.ecosystemCount} ecosystem hooks`,
    ]);
  }
  if (context.fundamentals.socialFollowers !== null) {
    rows.push([
      isZh ? '社交关注' : 'Followers',
      context.fundamentals.socialFollowers.toLocaleString(),
      context.fundamentals.hotIndexScore !== null
        ? `Hot ${context.fundamentals.hotIndexScore.toFixed(1)}`
        : isZh
          ? '社交热度参考'
          : 'Social heat context',
    ]);
  }

  if (rows.length === 0) {
    return isZh
      ? '• 当前没有更细的基本面结构数据。'
      : '• No richer fundamentals detail is available.';
  }

  return [
    `| ${isZh ? '维度' : 'Dimension'} | ${isZh ? '当前信息' : 'Current Detail'} | ${isZh ? '用途' : 'Why It Matters'} |`,
    '|---|---|---|',
    ...rows.map(([label, value, meaning]) => `| ${label} | ${value} | ${meaning} |`),
  ].join('\n');
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

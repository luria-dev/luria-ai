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
    change30dPct: number | null;
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
    onchainDetails: {
      inflowUsd: number | null;
      outflowUsd: number | null;
      netflowUsd: number | null;
      exchangeCount: number;
    };
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
    description: string | null;
    establishmentDate: string | null;
    totalFundingUsd: number | null;
    rtScore: number | null;
    tvlScore: number | null;
    investorCount: number;
    topInvestors: string[];
    investorDetails: Array<{
      name: string;
      type: string | null;
    }>;
    teamHighlights: Array<{
      name: string;
      position: string | null;
    }>;
    fundraisingCount: number;
    latestRound: {
      round: string | null;
      amountUsd: number | null;
      publishedAt: string | null;
      investors: string[];
    } | null;
    recentRounds: Array<{
      round: string | null;
      amountUsd: number | null;
      valuationUsd: number | null;
      publishedAt: string | null;
      investors: string[];
    }>;
    ecosystemCount: number;
    ecosystemHighlights: string[];
    ecosystemBreakdown: {
      ecosystems: string[];
      onMainNet: string[];
      onTestNet: string[];
      planToLaunch: string[];
    };
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
    allocation: {
      teamPct: number | null;
      investorPct: number | null;
      communityPct: number | null;
      foundationPct: number | null;
    };
    vestingSchedule: Array<{
      bucket: string;
      start: string;
      cliffMonths: number;
      unlockFrequency: string;
      end: string;
    }>;
    sourceUsed: string[];
    evidenceFields: string[];
    evidenceSources: string[];
    evidenceInsufficient: boolean;
    burns: {
      totalBurnAmount: number | null;
      recentBurnCount: number;
      latestBurnDate: string | null;
      burnSummary: string | null;
      recentBurns: Array<{
        burnEventLabel: string;
        burnType: string;
        burnDate: string;
        amount: number;
      }>;
    };
    buybacks: {
      totalBuybackAmount: number | null;
      recentBuybackCount: number;
      latestBuybackDate: string | null;
      buybackSummary: string | null;
      recentBuybacks: Array<{
        buybackEventLabel: string;
        buybackType: string;
        buybackDate: string;
        tokenAmount: number;
        spentAmount: number;
        spentUnit: string;
      }>;
    };
    fundraising: {
      totalRaised: number | null;
      roundCount: number;
      latestRoundDate: string | null;
      fundraisingSummary: string | null;
      recentRounds: Array<{
        roundName: string;
        fundingDate: string;
        amountRaised: number;
        currency: string;
        valuation: number | null;
        investors: string[];
      }>;
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
You are a senior crypto analyst writing serious research notes, not a chatbot summary. Your job is to turn the supplied evidence into a clear, task-oriented report that feels complete, data-aware, and decision-useful.

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

## Opening Format
- Start with a direct title that states the core conclusion.
- Immediately after the title, include a compact verdict box.
- The verdict box must summarize:
  - the conclusion,
  - confidence,
  - the single most important takeaway.
- The verdict box should be short, visual, and easy to scan.
- After the verdict box, continue into "## 关键回答" / "## Core Answer".

## Output Structure
- "## 关键回答" / "## Core Answer" is mandatory.
- After that, include only the sections needed for the user's task.
- In explain or assess mode, the report should usually have enough substance to feel like a real research note, not a short memo.
- Unless evidence is truly sparse, explain or assess mode should usually include a fuller research structure.
- In explain or assess mode, use as many compact tables as genuinely help the reader. Often this is 2-4, but it can be fewer or more when the evidence naturally calls for it.
- In explain or assess mode, try to let each section do a different job. Avoid restating the same conclusion in multiple sections with slightly different wording.
- In explain or assess mode, do not stop at naming the judgment. Expand it into a short cause-and-effect chain so the reader can see why that judgment holds.
- For explain or assess mode with sufficient evidence, these sections often work well:
  - 关键回答 / Core Answer
  - 关键数据快照 / Key Snapshot
  - 外部证据摘要 or 核心驱动与风险 / External Evidence Summary or Drivers and Risks
  - 市场情况 / Market State
  - 基本面 / Fundamentals
  - 情绪与资金面 / Sentiment and Positioning
  - 技术与结构 / Technical Structure
  - 风险提示 / Risk Warnings
  - 接下来观察什么 / What To Watch Next
- The order above is guidance, not a rigid template. Reorder or merge sections when that makes the strongest evidence easier to understand.
- If one of the sections above is genuinely unsupported by evidence, omit it explicitly and let the nearby sections absorb the explanation. Do not compress the whole report just because one section is weak.
- The body must begin with a single "# " title line.
- Use "##" for main sections and "###" for sub-sections when needed.
- Never use numbered headings.
- When the supplied evidence contains at least 3 usable structured metrics, include 1 compact markdown table near the top. Do not default to a pure long-form essay.
- That first table should usually be "关键数据快照" / "Key Snapshot".
- If open research or news evidence materially affects the answer, prefer a second compact table instead of burying those points in prose.
- In explain or assess mode, tables are often useful, but do not force the report into a table-heavy shape if prose carries the answer better.
- In explain or assess mode, if the report makes 2 or more material judgments, a compact "关键判断验证状态 / Validation Status" table is often useful.
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
- Lead with data, then interpret it. Do not jump from a vague conclusion to more vague conclusion.
- For each major section, try to anchor the main claim in 2-3 concrete data points or named facts when that evidence is available.
- If a major structured module is available and relevant, explain why it matters; do not silently ignore it for brevity.
- If liquidity contains top venues or pool-level detail, cite at least 1-2 concrete pair or venue facts instead of saying only "liquidity is strong/weak".
- If fundamentals contain investors, fundraising, ecosystem deployment, or social data, cite at least 1 concrete fact from those fields when they materially support the thesis.
- If raw fundamentals rows are supplied, use at least 2 concrete named rows when they are relevant, such as investor names, funding rounds, team roles, or ecosystem deployment lines.
- If raw tokenomics rows are supplied, use them directly instead of collapsing them into only total counts or one generic sentence.
- Do not replace concrete evidence with generic labels when the concrete evidence is already available. For example, prefer named investors, exact rounds, explicit burns, exact netflow, explicit venue shares, and exact percentage changes over phrases like "top-tier backing", "ongoing burns", "buy pressure", or "strong liquidity".
- Do not repeat the same evidence item in more than one main section unless the repetition is necessary to resolve a conflict between signals.
- If the same fact appears in a table, the paragraph below should explain its meaning, not restate the fact sentence-by-sentence.
- Do not force balanced coverage across modules. Give more space to the modules and evidence rows that actually move the conclusion, and keep weaker evidence brief.
- For every major conclusion, explain three things when evidence allows:
  1. what facts support it,
  2. why those facts are more convincing than the closest competing explanation,
  3. what future evidence would invalidate or materially weaken that conclusion.
- If the report says a move is not driven by X, explain what evidence would have been expected if X were truly the main driver.
- Distinguish between verified evidence, directional but incomplete evidence, and missing verification. Do not present all evidence with the same certainty level.

## Data Density
- When evidence is rich, the report should feel data-dense rather than thesis-thin.
- Surface as many relevant concrete metrics as are genuinely useful; do not stop after only 3-4 metrics when the prompt contains much more.
- In explain or assess mode with rich evidence, the report should usually surface a broad metric set across price, volume, technicals, liquidity, sentiment, fundamentals, tokenomics, and external evidence, as long as those metrics help answer the question.
- Do not collapse several meaningful metrics into vague phrases such as "liquidity is solid", "sentiment is weak", or "fundamentals are mixed" without showing the supporting facts.
- If a value is unavailable, omit it from the report rather than printing placeholders.

## Data Explanation
- Do not treat numbers as decoration. When a section uses data, explain what the numbers imply for the user's question.
- If a paragraph cites a concrete metric, usually connect it to a meaning such as trend strength, valuation pressure, adoption quality, liquidity quality, or risk transmission.
- Prefer statements like "X is Y, which suggests Z" over isolated fact sentences.
- In strong sections, try to surface 2-4 concrete values or named facts and explain how they fit together.
- If several numbers point in the same direction, say so explicitly. If they conflict, explain the conflict instead of listing them separately.
- When one data point matters more than the rest, say why it deserves more weight.
- Prefer exact numbers over qualitative substitutes when the exact numbers are present in the prompt.
- If a named fact is important enough to appear in a table, it is usually important enough to appear at least once in the prose as well.
- When the prompt contains multiple useful rows for the same theme, synthesize them into one argument instead of mentioning only the first row and ignoring the rest.

## Minimum Metric Surfacing Guide
- Use as many of these as are relevant and available:
  - price, 24h change, 7d change, 30d change
  - 24h volume, market cap, market cap rank, FDV, circulating ratio
  - RSI, MACD, MACD histogram
  - MA7, MA25, MA99
  - Bollinger upper, middle, lower
  - swing high, swing low, ATR
  - on-chain inflow, outflow, netflow
  - liquidity USD, top venues, pool share, price impact, liquidity drop
  - sentiment score, positive / negative split, social volume, dev activity
  - security risk level and risk score
  - inflation rate, burns, buybacks, fundraising
  - investors, ecosystem hooks, social followers, external evidence timeline
- You do not need to use every metric above, but if many are available, the report should visibly use many of them.

## Paragraph Depth
- Each primary section should usually contain enough prose to develop the argument, not just one thin paragraph.
- When evidence is rich, the paragraph block below a key table should usually do two jobs:
  1. explain what the table shows,
  2. explain what it means for the user question.
- When the question has multiple sub-questions, do not answer each one with a single sentence if the evidence supports more depth.
- Avoid bullet-only analysis sections. Use paragraphs for reasoning and bullets only when bullets are clearly the best format.
- Let high-signal sections breathe. A section built on strong evidence can be much longer than weaker sections; do not force equal treatment.

## Paragraph Design
- Write paragraphs like a research note, not like stacked talking points.
- Prefer fewer, fuller paragraphs over many 1-2 sentence fragments.
- A good analytical paragraph usually does three things in order:
  1. states the judgment or sub-claim,
  2. explains which evidence supports it,
  3. explains why that evidence matters or where its limit is.
- For important sections, prefer paragraphs of roughly 3-5 sentences when the evidence supports it.
- Do not break one idea into several tiny paragraphs unless the change in idea is real.
- After a key table, the first paragraph should usually summarize the signal cluster; the second paragraph should usually explain implication, tension, or boundary conditions.
- In "核心回答 / Core Answer", do not stop after one short answer paragraph. If the question is substantive, add a second paragraph that explains the main driver of the judgment.
- When discussing risks, avoid one-line risk bullets unless the section is explicitly a checklist. Explain the impact path in prose.
- When discussing fundamentals, tokenomics, or capital backing, prefer one coherent explanatory paragraph over several disconnected fact sentences.

## Readability Layout
- Optimize for easy scanning in Markdown, not for dense memo formatting.
- Leave a blank line between headings, tables, paragraphs, and bullet lists.
- Do not stack several tables back-to-back without a short transition line or paragraph between them unless the layout would otherwise become repetitive.
- Break very long paragraphs into smaller units when the idea naturally shifts.
- Prefer short sub-headings when they improve orientation, especially for multi-question reports.
- After a major table, add a short lead-out sentence or paragraph before moving to the next block.
- Avoid giant blocks of bullets. If more than 3 bullets are needed, consider whether a short paragraph or a table would read more clearly.
- Keep list items visually short; move the explanation into the paragraph below when the bullet starts getting long.

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
- In explain or assess mode, a small number of high-signal tables is better than forcing a fixed table count.
- Each table should usually have 3-5 rows. Split large tables into smaller ones instead of making one kitchen-sink table.
- Do not generate a large catch-all table with too many fields. Small, high-signal tables are better than exhaustive tables.
- If a table does not materially improve scanability, do not force one only to satisfy a format preference.
- Table cells should stay short and factual. Use prose below the table to explain why the numbers or sources matter.
- Prefer tables such as "关键数据快照 / Key Snapshot", "核心驱动与风险 / Drivers and Risks", or "外部证据摘要 / External Evidence Summary" over generic kitchen-sink tables.
- Keep tables narrow: usually 3 columns, sometimes 2, rarely 4. Do not turn them into dashboards.
- Omit rows whose values are unavailable. Do not print null, N/A, or placeholders.
- Keep prices, percentages, and large values consistently formatted.
- Each section must explain what the evidence means, not just list numbers.
- Keep paragraphs focused, but let them become complete enough to carry an argument. One paragraph should usually develop one idea rather than just mention it.
- Prefer visually clean Markdown:
  - one blank line before and after each table,
  - one blank line between consecutive paragraphs,
  - no dense wall of adjacent headings with no body text.
- If technical analysis is used, interpret RSI, MACD, MA alignment, Bollinger position, and structure from the supplied numbers.
- If tokenomics is used, interpret inflation, burns, buybacks, and fundraising in supply / dilution terms.
- If allocation, vesting, or recent tokenomics events are provided, prefer a dedicated compact tokenomics table over a vague tokenomics paragraph.
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
- In explain or assess mode, do not compress a rich prompt into a memo-length answer.
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
${context.market.change30dPct !== null ? `| ${isZh ? '30天涨跌' : '30d Change'} | ${fmtPct(context.market.change30dPct)} | ${isZh ? '中期趋势参考' : 'Medium-term trend context'} |` : ''}
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
${context.signals.onchainDetails.inflowUsd !== null ? `| ${isZh ? '链上流入' : 'On-chain Inflow'} | ${fmtCurrency(context.signals.onchainDetails.inflowUsd)} |` : ''}
${context.signals.onchainDetails.outflowUsd !== null ? `| ${isZh ? '链上流出' : 'On-chain Outflow'} | ${fmtCurrency(context.signals.onchainDetails.outflowUsd)} |` : ''}
${context.signals.onchainDetails.netflowUsd !== null ? `| ${isZh ? '链上净流向' : 'On-chain Netflow'} | ${fmtCurrency(context.signals.onchainDetails.netflowUsd)} |` : ''}
| 24h Volume | ${fmtCurrency(context.signals.liquidityDetails.volume24hUsd)} |
| Liquidity Drop 1h | ${context.signals.liquidityDetails.liquidityDrop1hPct !== null ? fmtPct(context.signals.liquidityDetails.liquidityDrop1hPct) : 'N/A'} |
| Price Impact 1k | ${context.signals.liquidityDetails.priceImpact1kPct !== null ? context.signals.liquidityDetails.priceImpact1kPct.toFixed(2) + '%' : 'N/A'} |

## Liquidity Venue Detail
${renderLiquidityVenues(context, isZh)}

## Fundamentals Detail
${renderFundamentalsDetail(context, isZh)}

## Tokenomics Detail
${renderTokenomicsDetail(context, isZh)}

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

## Structured Data Coverage Hints
${renderCoverageHints(context, isZh)}

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
- Use the structured data coverage hints above as an explicit reminder of what concrete evidence is available.
- Keep the explanation readable for non-specialists without becoming shallow or overly compressed.
- In explain or assess mode, use the number of tables that best fits the evidence. Do not force a fixed count.
- If there are enough usable metrics, add a compact "关键数据快照" / "Key Snapshot" table near the top.
- Use the supplied table blueprint as guidance, not a rigid template.
- Use tables to present facts first; use the paragraphs below them to explain why those facts matter.
- Do not leave important numbers trapped inside tables. Pull the most important values back into the prose and explain them.
- In the body prose, prefer concrete numbers and named facts over generic summaries whenever the concrete evidence is available.
- Keep the Markdown visually breathable: use blank lines, clean section breaks, and natural paragraph splitting so the report is easy to read in a frontend renderer.
- Prefer several small, question-specific tables over one generic summary table.
- Keep the report structurally clean: each section should add new information, not repackage the same point.
- When evidence is rich, surface a broad set of concrete metrics rather than only a small headline subset.
- If the user asks about what changed, why price moved, what the biggest risk is, or whether the move is fundamentals vs sentiment, the report should visibly use external evidence instead of relying only on internal structured metrics.
- Surface the key quantitative state early only when it helps answer the question.
- Explain conflicts between signals and state which evidence you weight more heavily.
- In explain or assess mode, if sentiment, liquidity, on-chain, fundamentals, and tokenomics contain useful information, actively use them instead of leaving them unused.
- When open research provides useful evidence, show how it changed, confirmed, or limited the conclusion.
- If raw fundamentals or tokenomics detail tables are supplied, consume them explicitly in the report instead of leaving them as unused appendix material.
- If recent burn, buyback, fundraising, vesting, or investor rows are supplied, cite the most relevant rows directly.
- Do not give every module equal space. Let the strongest evidence take the most room, and keep weaker modules brief.
- In the strongest sections, explicitly explain the meaning of the key metrics instead of only displaying them.
- For a substantive report, the reader should be able to point to concrete numbers or named facts in the prose, not only in the tables.
- Avoid wording like "机构背书强", "流动性较好", "存在买压", or "资金关注度较高" unless the sentence also shows the underlying supporting data.
- Do not let formatting collapse into: heading -> table -> heading -> table. Add brief connective prose so the reader can follow the argument.
- Include what matters now, what to watch next, and what would invalidate the thesis.
- For each major conclusion, show the reasoning path instead of jumping from data to answer in one sentence.
- If you reject an obvious alternative interpretation, say why it is weaker than the main interpretation.
- In explain mode, focus on understanding, not advice.
- In assess mode, focus on judgment and conditions, not trade execution.
- In act mode, concrete execution framing is allowed.
- When the report contains several sub-questions, let each major table answer one sub-question cleanly.
- Keep paragraphs anchored to the table or evidence block directly above them, but give them enough room to explain meaning rather than only restate facts.
- If a key table carries important evidence, give it enough explanation to show why it matters and where its limits are.
- When one evidence block is especially important, it is fine for that section to be materially longer than the rest.
- Avoid paragraph sequences that read like: conclusion sentence -> loose fact sentence -> generic caution sentence. Combine them into a more developed argument.
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
          '- 这类问题通常适合 3-4 张小表；如果前 2-3 张已经足够清楚，不必硬凑。',
          '- 表 1：`关键数据快照`。放价格、涨跌幅、RSI、成交量、情绪分等基础状态。',
          '- 表 2：`基本面证据`。放开发、采用、产品发布、链上使用、机构采用等可验证事实。',
          '- 表 3：`情绪与资金面证据`。放社交热度、情绪分、资金流、新闻催化、短线投机信号。',
          '- 如果需要收束判断，可加表 4：`基本面 vs 情绪结论对照`。用“证据 / 指向 / 结论”三列，直接判断更偏哪一边。',
          '- 如果报告里存在多条关键判断，再考虑补一张：`关键判断验证状态`。',
          '- 每张表下面用 1-2 段短文解释，不要先写大段综述再补表。',
          '- 在对照表之后，要明确展开三件事：为什么不像基本面驱动、为什么也不像纯情绪驱动、剩下更像什么解释。',
        ].join('\n')
      : [
          '- This type of question often works well with 3-4 compact tables; if the first 2-3 already make the case clearly, do not force more.',
          '- Table 1: `Key Snapshot` with price, returns, RSI, volume, sentiment score, and current state.',
          '- Table 2: `Fundamentals Evidence` with adoption, launches, developer activity, usage, and institution-related facts.',
          '- Table 3: `Sentiment and Positioning Evidence` with social activity, sentiment, flows, catalysts, and speculative signals.',
          '- If needed to tighten the call, add Table 4: `Fundamentals vs Sentiment Verdict` using short columns such as evidence / direction / conclusion.',
          '- Add `Validation Status` only when the report makes several distinct judgments.',
          '- After each table, use 1-2 short paragraphs to interpret it instead of front-loading a long essay.',
          '- After the comparison table, explicitly explain why the move is not mainly fundamentals, why it is not mainly sentiment either when applicable, and what the more plausible residual explanation is.',
        ].join('\n');
  }

  if (profile === 'drivers_risks_investability') {
    return isZh
      ? [
          '- 这类问题通常适合 3-4 张小表；如果 2-3 张已经能把驱动、风险和判断说透，也可以更少。',
          '- 表 1：`关键数据快照`。放价格、趋势、流动性、链上流向、风险等级等。',
          '- 表 2：`上涨驱动因素`。把每个驱动拆成“驱动 / 证据 / 持续性判断”。',
          '- 表 3：`主要风险`。把每个风险拆成“风险 / 当前迹象 / 影响路径”。',
          '- 如果需要把结论收口，可加表 4：`当前投资判断`。用“支持投资 / 不支持投资 / 需要新增验证”三列，直接回答“现在适不适合”。',
          '- 如果驱动、风险、投资结论都各自独立，再考虑加一张：`关键判断验证状态`。',
          '- 解释段落围绕每张表展开，不要把驱动、风险、投资判断混在一段里。',
          '- 三个核心问题都要单独展开：为什么驱动不够硬、为什么这个风险最大、为什么现在不适合或适合投资，以及需要什么变化才会改判。',
        ].join('\n')
      : [
          '- This type of question often works well with 3-4 compact tables; if 2-3 already answer the drivers, risks, and investability call clearly, fewer is fine.',
          '- Table 1: `Key Snapshot` with price, trend, liquidity, on-chain flow, and current risk state.',
          '- Table 2: `Upside Drivers` with driver / evidence / durability.',
          '- Table 3: `Major Risks` with risk / current signs / impact path.',
          '- If helpful to close the answer, add Table 4: `Current Investment Judgment` with columns such as supports investing / does not support investing / what still needs confirmation.',
          '- Add `Validation Status` only when the report makes several distinct judgments that benefit from verification labels.',
          '- Keep prose tied to each table. Do not blend drivers, risks, and investability into one dense block.',
          '- Expand the three user jobs separately: why the upside drivers are not yet strong enough, why the named biggest risk matters more than other risks, and why the asset is or is not investable right now plus what would need to change.',
        ].join('\n');
  }

  if (profile === 'relationship_dependency') {
    return isZh
      ? [
          '- 这类问题通常适合 3-4 张小表；如果关系定义和证据/反证已经足够清楚，不必凑满。',
          '- 表 1：`关系定义`。说明这是生态关系、业务关系、流动性关系、叙事关系还是价值捕获关系。',
          '- 表 2：`传导机制`。列出这层关系如何传导到价格、需求、用户、流动性或估值想象。',
          '- 表 3：`证据与反证`。同时列出支持关系成立的证据，以及削弱这层关系的反证。',
          '- 如果关系判断本身存在多层次，可以再加表 4：`关键判断验证状态`。',
          '- 正文必须明确解释：关系到底强不强、为什么不是简单同步上涨关系、什么条件下这层关系会减弱或失效。',
        ].join('\n')
      : [
          '- This type of question often works well with 3-4 compact tables; if relationship definition plus evidence / counter-evidence already make the answer clear, do not force more.',
          '- Table 1: `Relationship Definition`, clarifying whether the linkage is ecosystem, business, liquidity, narrative, or value-capture based.',
          '- Table 2: `Transmission Mechanism`, explaining how the linkage could transmit into price, demand, users, liquidity, or valuation.',
          '- Table 3: `Evidence and Counter-Evidence`, showing what supports the relationship and what weakens it.',
          '- Add Table 4: `Validation Status` only when the relationship has multiple layers that need verification labels.',
          '- The prose must explain how strong the linkage really is, why it is not just simple price co-movement, and under what conditions the linkage would weaken or break.',
        ].join('\n');
  }

  if (profile === 'recent_and_l2_progress') {
    return isZh
      ? [
          '- 这类问题通常适合 3-4 张小表；若外部证据有限，2-3 张也可以。',
          '- 表 1：`近期动态时间线`。按时间列出最近关键事件、发布、升级、基金会动作。',
          '- 表 2：`L2进展状态`。按项目或主题列出“进展点 / 当前状态 / 是否有量化验证”。',
          '- 表 3：`关键数据快照`。放价格、成交量、链上/情绪信号，用来说明市场是否已反映这些变化。',
          '- 如果确实存在大量未验证事项，再加表 4：`待验证事项`。',
          '- 正文重点解释“发生了什么、哪些是实质进展、哪些只是叙事”。',
          '- 要明确拆开讲：哪些是已经落地的真实进展，哪些只是战略表述，以及这些变化为什么还没有明显传导到价格。',
        ].join('\n')
      : [
          '- This type of question often works well with 3-4 compact tables; if external evidence is thinner, 2-3 can be enough.',
          '- Table 1: `Recent Developments Timeline` listing the latest launches, upgrades, foundation actions, and ecosystem events.',
          '- Table 2: `L2 Progress Status` with progress item / current status / whether it has quantitative proof.',
          '- Table 3: `Key Snapshot` showing price, volume, and major on-chain or sentiment signals to test whether the market has priced it in.',
          '- Add Table 4: `What Still Needs Validation` when there is enough unresolved evidence to justify it.',
          '- The prose should mainly clarify what actually changed, what is substantive, and what is still just narrative.',
          '- Explicitly separate real shipped progress, strategic messaging or governance framing, and why those changes have or have not translated into ETH price action.',
        ].join('\n');
  }

  if (context.planning.responseMode === 'assess') {
    return isZh
      ? [
          '- 这类问题通常适合 2-4 张小表。',
          '- 表 1：`关键数据快照`。',
          '- 表 2：`核心驱动与风险`。',
          '- 表 3：`信号交叉验证`，对照基本面、情绪、链上、技术是否一致。',
          '- 如果需要，再加表 4：`接下来观察什么`。',
          '- 先让表回答问题，再用短段落解释。避免长段纯文字。',
        ].join('\n')
      : [
          '- This type of question often works well with 2-4 compact tables.',
          '- Table 1: `Key Snapshot`.',
          '- Table 2: `Drivers and Risks`.',
          '- Table 3: `Signal Cross-check` across fundamentals, sentiment, on-chain, and technical structure.',
          '- Add Table 4: `What To Watch Next` when it adds clarity.',
          '- Let the tables answer first, then use short paragraphs to interpret them. Avoid long pure-prose blocks.',
        ].join('\n');
  }

  return isZh
    ? [
        '- 一般适合 2-4 张小表，按证据自然组织即可。',
        '- 表 1：`关键数据快照`。',
        '- 表 2：`外部证据摘要`。',
        '- 表 3：`信号对照表`，把市场、基本面、情绪、链上中最相关的信号并列。',
        '- 如果需要，再加表 4：`接下来观察什么`。',
        '- 表格是主信息层，正文只负责解释表格中的关键冲突与结论。',
      ].join('\n')
    : [
        '- This usually works well with 2-4 compact tables, organized naturally around the evidence.',
        '- Table 1: `Key Snapshot`.',
        '- Table 2: `External Evidence Summary`.',
        '- Table 3: `Signal Cross-check`, placing the most relevant market, fundamentals, sentiment, and on-chain signals side by side.',
        '- Add Table 4: `What To Watch Next` only when it improves clarity.',
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
  if (context.fundamentals.description) {
    rows.push([
      isZh ? '项目描述' : 'Description',
      truncate(context.fundamentals.description, 96),
      isZh ? '帮助识别业务定位' : 'Clarifies the operating model',
    ]);
  }
  if (context.fundamentals.establishmentDate) {
    rows.push([
      isZh ? '成立时间' : 'Founded',
      context.fundamentals.establishmentDate,
      isZh ? '历史成熟度' : 'Maturity context',
    ]);
  }
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
    '',
    renderFundamentalsRawRows(context, isZh),
  ].join('\n');
}

function renderFundamentalsRawRows(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const parts: string[] = [];

  if (context.fundamentals.investorDetails.length > 0) {
    parts.push(
      [
        `### ${isZh ? '投资方明细' : 'Investor Rows'}`,
        `| ${isZh ? '投资方' : 'Investor'} | ${isZh ? '类型' : 'Type'} |`,
        '|---|---|',
        ...context.fundamentals.investorDetails
          .slice(0, 5)
          .map(
            (item) =>
              `| ${item.name} | ${item.type ?? (isZh ? '未披露' : 'Not disclosed')} |`,
          ),
      ].join('\n'),
    );
  }

  if (context.fundamentals.recentRounds.length > 0) {
    parts.push(
      [
        `### ${isZh ? '融资轮次明细' : 'Fundraising Rows'}`,
        `| ${isZh ? '轮次' : 'Round'} | ${isZh ? '金额' : 'Amount'} | ${isZh ? '时间/投资方' : 'Date / Investors'} |`,
        '|---|---|---|',
        ...context.fundamentals.recentRounds
          .slice(0, 4)
          .map((round) => {
            const tail = [
              round.publishedAt,
              round.investors.length > 0 ? round.investors.slice(0, 3).join(', ') : null,
            ]
              .filter(Boolean)
              .join(' / ');
            return `| ${round.round ?? (isZh ? '未命名' : 'Unnamed')} | ${round.amountUsd !== null ? fmtCurrency(round.amountUsd) : (isZh ? '未披露' : 'Not disclosed')} | ${tail || (isZh ? '无更多披露' : 'No extra disclosure')} |`;
          }),
      ].join('\n'),
    );
  }

  if (
    context.fundamentals.ecosystemBreakdown.ecosystems.length > 0 ||
    context.fundamentals.ecosystemBreakdown.onMainNet.length > 0 ||
    context.fundamentals.ecosystemBreakdown.onTestNet.length > 0 ||
    context.fundamentals.ecosystemBreakdown.planToLaunch.length > 0
  ) {
    const ecoCandidates: Array<[string, string]> = [
      [
        isZh ? '生态归属' : 'Ecosystems',
        context.fundamentals.ecosystemBreakdown.ecosystems.slice(0, 4).join(', '),
      ],
      [
        isZh ? '主网' : 'Mainnet',
        context.fundamentals.ecosystemBreakdown.onMainNet.slice(0, 4).join(', '),
      ],
      [
        isZh ? '测试网' : 'Testnet',
        context.fundamentals.ecosystemBreakdown.onTestNet.slice(0, 4).join(', '),
      ],
      [
        isZh ? '计划上线' : 'Planned',
        context.fundamentals.ecosystemBreakdown.planToLaunch
          .slice(0, 4)
          .join(', '),
      ],
    ];
    const ecoRows = ecoCandidates.filter((row) => row[1]);
    parts.push(
      [
        `### ${isZh ? '生态部署明细' : 'Ecosystem Rows'}`,
        `| ${isZh ? '类别' : 'Category'} | ${isZh ? '项目/方向' : 'Items'} |`,
        '|---|---|',
        ...ecoRows.map(([label, value]) => `| ${label} | ${value} |`),
      ].join('\n'),
    );
  }

  if (context.fundamentals.teamHighlights.length > 0) {
    parts.push(
      [
        `### ${isZh ? '团队样本' : 'Team Rows'}`,
        `| ${isZh ? '成员' : 'Member'} | ${isZh ? '角色' : 'Role'} |`,
        '|---|---|',
        ...context.fundamentals.teamHighlights
          .slice(0, 5)
          .map(
            (member) =>
              `| ${member.name} | ${member.position ?? (isZh ? '未披露' : 'Not disclosed')} |`,
          ),
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

function renderTokenomicsDetail(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const parts: string[] = [];
  const allocationRows = [
    [isZh ? '团队' : 'Team', fmtPctRaw(context.tokenomics.allocation.teamPct)],
    [isZh ? '投资人' : 'Investors', fmtPctRaw(context.tokenomics.allocation.investorPct)],
    [isZh ? '社区' : 'Community', fmtPctRaw(context.tokenomics.allocation.communityPct)],
    [isZh ? '基金会/储备' : 'Foundation / Treasury', fmtPctRaw(context.tokenomics.allocation.foundationPct)],
  ].filter((row) => row[1] !== null) as Array<[string, string]>;

  if (allocationRows.length > 0 || context.tokenomics.sourceUsed.length > 0) {
    parts.push(
      [
        `| ${isZh ? '维度' : 'Dimension'} | ${isZh ? '当前信息' : 'Current Detail'} | ${isZh ? '用途' : 'Why It Matters'} |`,
        '|---|---|---|',
        ...allocationRows.map(
          ([label, value]) =>
            `| ${label} | ${value} | ${isZh ? '识别价值分配与潜在稀释压力' : 'Shows value distribution and dilution direction'} |`,
        ),
        context.tokenomics.sourceUsed.length > 0
          ? `| ${isZh ? '来源' : 'Sources'} | ${context.tokenomics.sourceUsed.join(', ')} | ${context.tokenomics.evidenceFields.join(', ') || (isZh ? '字段证据' : 'Evidence fields')} |`
          : '',
        context.tokenomics.evidenceInsufficient
          ? `| ${isZh ? '证据状态' : 'Evidence state'} | ${isZh ? '部分不足' : 'Partial'} | ${isZh ? '对分配/解锁结论要保留弹性' : 'Allocation / vesting conclusions need caution'} |`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (context.tokenomics.vestingSchedule.length > 0) {
    parts.push(
      [
        `### ${isZh ? '解锁时间表样本' : 'Vesting Rows'}`,
        `| ${isZh ? 'Bucket' : 'Bucket'} | ${isZh ? '起止' : 'Start / End'} | ${isZh ? 'Cliff/频率' : 'Cliff / Frequency'} |`,
        '|---|---|---|',
        ...context.tokenomics.vestingSchedule.slice(0, 5).map((item) => {
          const period = [item.start, item.end].filter(Boolean).join(' -> ');
          return `| ${item.bucket} | ${period} | ${item.cliffMonths}m / ${item.unlockFrequency} |`;
        }),
      ].join('\n'),
    );
  }

  const eventBlocks = [
    renderBurnRows(context, isZh),
    renderBuybackRows(context, isZh),
    renderTokenomicsFundraisingRows(context, isZh),
  ].filter(Boolean);
  if (eventBlocks.length > 0) {
    parts.push(...eventBlocks);
  }

  if (parts.length === 0) {
    return isZh
      ? '• 当前没有更细的代币经济结构数据。'
      : '• No richer tokenomics detail is available.';
  }

  return parts.join('\n\n');
}

function renderBurnRows(context: ReportPromptContext, isZh: boolean): string {
  const burns = context.tokenomics.burns;
  if (burns.totalBurnAmount === null && burns.recentBurns.length === 0) {
    return '';
  }
  return [
    `### ${isZh ? '销毁事件样本' : 'Burn Rows'}`,
    `| ${isZh ? '日期' : 'Date'} | ${isZh ? '事件' : 'Event'} | ${isZh ? '数量' : 'Amount'} |`,
    '|---|---|---|',
    ...burns.recentBurns.slice(0, 5).map((item) => {
      const label = `${item.burnEventLabel} (${item.burnType})`;
      return `| ${item.burnDate} | ${label} | ${fmtTokenAmount(item.amount)} |`;
    }),
    burns.totalBurnAmount !== null
      ? `| ${isZh ? '累计' : 'Total'} | ${isZh ? '累计销毁' : 'Cumulative burns'} | ${fmtTokenAmount(burns.totalBurnAmount)} |`
      : '',
    burns.burnSummary ? `| ${isZh ? '摘要' : 'Summary'} | ${burns.burnSummary} | - |` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderBuybackRows(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const buybacks = context.tokenomics.buybacks;
  if (
    buybacks.totalBuybackAmount === null &&
    buybacks.recentBuybacks.length === 0
  ) {
    return '';
  }
  return [
    `### ${isZh ? '回购事件样本' : 'Buyback Rows'}`,
    `| ${isZh ? '日期' : 'Date'} | ${isZh ? '事件' : 'Event'} | ${isZh ? '数量/花费' : 'Amount / Spend'} |`,
    '|---|---|---|',
    ...buybacks.recentBuybacks.slice(0, 5).map((item) => {
      const value = `${fmtTokenAmount(item.tokenAmount)} / ${fmtCurrencyish(item.spentAmount, item.spentUnit)}`;
      return `| ${item.buybackDate} | ${item.buybackEventLabel} (${item.buybackType}) | ${value} |`;
    }),
    buybacks.totalBuybackAmount !== null
      ? `| ${isZh ? '累计' : 'Total'} | ${isZh ? '累计回购' : 'Cumulative buybacks'} | ${fmtTokenAmount(buybacks.totalBuybackAmount)} |`
      : '',
    buybacks.buybackSummary ? `| ${isZh ? '摘要' : 'Summary'} | ${buybacks.buybackSummary} | - |` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderTokenomicsFundraisingRows(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const fundraising = context.tokenomics.fundraising;
  if (fundraising.totalRaised === null && fundraising.recentRounds.length === 0) {
    return '';
  }
  return [
    `### ${isZh ? '代币经济融资样本' : 'Tokenomics Fundraising Rows'}`,
    `| ${isZh ? '日期' : 'Date'} | ${isZh ? '轮次' : 'Round'} | ${isZh ? '金额/投资方' : 'Amount / Investors'} |`,
    '|---|---|---|',
    ...fundraising.recentRounds.slice(0, 5).map((item) => {
      const value = [
        fmtCurrencyish(item.amountRaised, item.currency),
        item.investors.length > 0 ? item.investors.slice(0, 3).join(', ') : null,
      ]
        .filter(Boolean)
        .join(' / ');
      return `| ${item.fundingDate} | ${item.roundName} | ${value || (isZh ? '无更多披露' : 'No extra disclosure')} |`;
    }),
    fundraising.totalRaised !== null
      ? `| ${isZh ? '累计' : 'Total'} | ${isZh ? '累计融资' : 'Cumulative raised'} | ${fmtCurrency(fundraising.totalRaised)} |`
      : '',
    fundraising.fundraisingSummary
      ? `| ${isZh ? '摘要' : 'Summary'} | ${fundraising.fundraisingSummary} | - |`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderCoverageHints(
  context: ReportPromptContext,
  isZh: boolean,
): string {
  const hints: string[] = [];
  const marketHints = [
    context.market.priceUsd !== null
      ? `${isZh ? '价格' : 'Price'}=${fmtCurrency(context.market.priceUsd)}`
      : null,
    context.market.change24hPct !== null
      ? `${isZh ? '24h涨跌' : '24h'}=${fmtPct(context.market.change24hPct)}`
      : null,
    context.market.change7dPct !== null
      ? `${isZh ? '7d涨跌' : '7d'}=${fmtPct(context.market.change7dPct)}`
      : null,
    context.market.change30dPct !== null
      ? `${isZh ? '30d涨跌' : '30d'}=${fmtPct(context.market.change30dPct)}`
      : null,
    context.market.volume24hUsd !== null
      ? `${isZh ? '24h成交量' : '24h volume'}=${fmtCurrency(context.market.volume24hUsd)}`
      : null,
    context.market.marketCapUsd !== null
      ? `${isZh ? '市值' : 'Market cap'}=${fmtCurrency(context.market.marketCapUsd)}`
      : null,
    context.market.marketCapRank !== null
      ? `${isZh ? '市值排名' : 'Rank'}=#${context.market.marketCapRank}`
      : null,
    context.market.fdvUsd !== null
      ? `FDV=${fmtCurrency(context.market.fdvUsd)}`
      : null,
  ].filter(Boolean);
  if (marketHints.length > 0) {
    hints.push(`- ${isZh ? '市场可用指标' : 'Market metrics available'}: ${marketHints.join(' | ')}`);
  }

  const technicalHints = [
    context.signals.technicalDetails.rsi.value !== null
      ? `RSI=${context.signals.technicalDetails.rsi.value.toFixed(1)}`
      : null,
    context.signals.technicalDetails.macd.value !== null
      ? `MACD=${context.signals.technicalDetails.macd.value.toFixed(2)}`
      : null,
    context.signals.technicalDetails.macd.histogram !== null
      ? `${isZh ? '柱状图' : 'Histogram'}=${context.signals.technicalDetails.macd.histogram.toFixed(2)}`
      : null,
    context.signals.technicalDetails.ma.ma7 !== null
      ? `MA7=${fmtCurrency(context.signals.technicalDetails.ma.ma7)}`
      : null,
    context.signals.technicalDetails.ma.ma25 !== null
      ? `MA25=${fmtCurrency(context.signals.technicalDetails.ma.ma25)}`
      : null,
    context.signals.technicalDetails.ma.ma99 !== null
      ? `MA99=${fmtCurrency(context.signals.technicalDetails.ma.ma99)}`
      : null,
    context.signals.technicalDetails.swingHigh !== null
      ? `${isZh ? '前高' : 'Swing high'}=${fmtCurrency(context.signals.technicalDetails.swingHigh)}`
      : null,
    context.signals.technicalDetails.swingLow !== null
      ? `${isZh ? '前低' : 'Swing low'}=${fmtCurrency(context.signals.technicalDetails.swingLow)}`
      : null,
  ].filter(Boolean);
  if (technicalHints.length > 0) {
    hints.push(`- ${isZh ? '技术可用指标' : 'Technical metrics available'}: ${technicalHints.join(' | ')}`);
  }

  const liquidityHints = [
    context.signals.liquidityUsd !== null
      ? `${isZh ? '流动性' : 'Liquidity'}=${fmtCurrency(context.signals.liquidityUsd)}`
      : null,
    context.signals.liquidityDetails.volume24hUsd !== null
      ? `${isZh ? '流动性24h量' : 'Liquidity 24h volume'}=${fmtCurrency(context.signals.liquidityDetails.volume24hUsd)}`
      : null,
    context.signals.liquidityDetails.priceImpact1kPct !== null
      ? `${isZh ? '$1k冲击' : '$1k impact'}=${context.signals.liquidityDetails.priceImpact1kPct.toFixed(2)}%`
      : null,
    context.signals.liquidityDetails.liquidityDrop1hPct !== null
      ? `${isZh ? '1h流动性变化' : '1h liquidity change'}=${fmtPct(context.signals.liquidityDetails.liquidityDrop1hPct)}`
      : null,
    context.signals.liquidityDetails.topVenues.length > 0
      ? `${isZh ? '主市场' : 'Top venues'}=${context.signals.liquidityDetails.topVenues
          .slice(0, 3)
          .map((venue) => venue.pairLabel)
          .join(', ')}`
      : null,
  ].filter(Boolean);
  if (liquidityHints.length > 0) {
    hints.push(`- ${isZh ? '流动性可用指标' : 'Liquidity metrics available'}: ${liquidityHints.join(' | ')}`);
  }

  const sentimentHints = [
    context.signals.onchainDetails.netflowUsd !== null
      ? `${isZh ? '链上净流向' : 'Netflow'}=${fmtCurrency(context.signals.onchainDetails.netflowUsd)}`
      : null,
    context.signals.sentimentDetails.sentimentScore !== null
      ? `${isZh ? '情绪分' : 'Sentiment score'}=${context.signals.sentimentDetails.sentimentScore.toFixed(1)}`
      : null,
    context.signals.sentimentDetails.sentimentPositive !== null
      ? `${isZh ? '正面情绪' : 'Positive'}=${context.signals.sentimentDetails.sentimentPositive.toFixed(1)}%`
      : null,
    context.signals.sentimentDetails.sentimentNegative !== null
      ? `${isZh ? '负面情绪' : 'Negative'}=${context.signals.sentimentDetails.sentimentNegative.toFixed(1)}%`
      : null,
    context.signals.sentimentDetails.socialVolume !== null
      ? `${isZh ? '社交热度' : 'Social volume'}=${context.signals.sentimentDetails.socialVolume.toLocaleString()}`
      : null,
    context.signals.sentimentDetails.devActivity !== null
      ? `${isZh ? '开发活跃' : 'Dev activity'}=${context.signals.sentimentDetails.devActivity.toLocaleString()}`
      : null,
  ].filter(Boolean);
  if (sentimentHints.length > 0) {
    hints.push(`- ${isZh ? '情绪可用指标' : 'Sentiment metrics available'}: ${sentimentHints.join(' | ')}`);
  }

  const fundamentalsHints = [
    context.signals.projectOneLiner
      ? `${isZh ? '定位' : 'One-liner'}=${context.signals.projectOneLiner}`
      : null,
    context.fundamentals.description
      ? `${isZh ? '描述' : 'Description'}=${truncate(context.fundamentals.description, 60)}`
      : null,
    context.fundamentals.totalFundingUsd !== null
      ? `${isZh ? '累计融资' : 'Funding'}=${fmtCurrency(context.fundamentals.totalFundingUsd)}`
      : null,
    context.fundamentals.topInvestors.length > 0
      ? `${isZh ? '投资方' : 'Investors'}=${context.fundamentals.topInvestors.slice(0, 3).join(', ')}`
      : null,
    context.fundamentals.recentRounds.length > 0
      ? `${isZh ? '融资轮次' : 'Funding rounds'}=${context.fundamentals.recentRounds
          .slice(0, 2)
          .map((round) => round.round)
          .filter(Boolean)
          .join(', ')}`
      : null,
    context.fundamentals.ecosystemHighlights.length > 0
      ? `${isZh ? '生态触点' : 'Ecosystem'}=${context.fundamentals.ecosystemHighlights.slice(0, 3).join(', ')}`
      : null,
    context.fundamentals.socialFollowers !== null
      ? `${isZh ? '关注者' : 'Followers'}=${context.fundamentals.socialFollowers.toLocaleString()}`
      : null,
  ].filter(Boolean);
  if (fundamentalsHints.length > 0) {
    hints.push(`- ${isZh ? '基本面可用指标' : 'Fundamentals available'}: ${fundamentalsHints.join(' | ')}`);
  }

  const tokenomicsHints = [
    context.signals.inflationRate !== null
      ? `${isZh ? '通胀率' : 'Inflation'}=${fmtPct(context.signals.inflationRate)}`
      : null,
    hasAnyAllocation(context.tokenomics.allocation)
      ? `${isZh ? '分配' : 'Allocation'}=${summarizeAllocation(context.tokenomics.allocation, isZh)}`
      : null,
    context.tokenomics.vestingSchedule.length > 0
      ? `${isZh ? '解锁条目' : 'Vesting rows'}=${context.tokenomics.vestingSchedule.length}`
      : null,
    context.tokenomics.burns.totalBurnAmount !== null
      ? `${isZh ? '销毁总量' : 'Total burns'}=${context.tokenomics.burns.totalBurnAmount.toLocaleString()}`
      : null,
    context.tokenomics.burns.recentBurns.length > 0
      ? `${isZh ? '近期销毁事件' : 'Recent burns'}=${context.tokenomics.burns.recentBurns.length}`
      : null,
    context.tokenomics.buybacks.totalBuybackAmount !== null
      ? `${isZh ? '回购总量' : 'Total buybacks'}=${context.tokenomics.buybacks.totalBuybackAmount.toLocaleString()}`
      : null,
    context.tokenomics.buybacks.recentBuybacks.length > 0
      ? `${isZh ? '近期回购事件' : 'Recent buybacks'}=${context.tokenomics.buybacks.recentBuybacks.length}`
      : null,
    context.tokenomics.fundraising.totalRaised !== null
      ? `${isZh ? '融资额' : 'Raised'}=${fmtCurrency(context.tokenomics.fundraising.totalRaised)}`
      : null,
    context.tokenomics.fundraising.recentRounds.length > 0
      ? `${isZh ? '融资轮次' : 'Fundraising rounds'}=${context.tokenomics.fundraising.recentRounds.length}`
      : null,
  ].filter(Boolean);
  if (tokenomicsHints.length > 0) {
    hints.push(`- ${isZh ? '代币经济可用指标' : 'Tokenomics available'}: ${tokenomicsHints.join(' | ')}`);
  }

  const externalHints = [
    context.recentEvidence.news.length > 0
      ? `${isZh ? '结构化新闻' : 'Structured news'}=${context.recentEvidence.news.length}`
      : null,
    context.recentEvidence.openResearch.items.length > 0
      ? `${isZh ? '开放研究条目' : 'Open research items'}=${context.recentEvidence.openResearch.items.length}`
      : null,
    context.recentEvidence.openResearch.takeaways.length > 0
      ? `${isZh ? '研究摘要' : 'Research takeaways'}=${context.recentEvidence.openResearch.takeaways.length}`
      : null,
  ].filter(Boolean);
  if (externalHints.length > 0) {
    hints.push(`- ${isZh ? '外部证据可用性' : 'External evidence available'}: ${externalHints.join(' | ')}`);
  }

  return hints.length > 0
    ? hints.join('\n')
    : isZh
      ? '- 当前无额外结构化覆盖提示。'
      : '- No additional structured coverage hints available.';
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

function fmtPctRaw(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toFixed(2)}%`;
}

function fmtTokenAmount(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  if (Math.abs(value) < 1 && value !== 0) {
    return value.toFixed(6);
  }
  return value.toFixed(2);
}

function fmtCurrencyish(value: number, unit: string): string {
  if (!Number.isFinite(value)) {
    return unit || '';
  }
  const normalizedUnit = unit?.trim().toUpperCase();
  if (normalizedUnit === 'USD' || normalizedUnit === 'USDC' || normalizedUnit === 'USDT') {
    return `${fmtCurrency(value)} ${normalizedUnit}`;
  }
  return `${fmtTokenAmount(value)} ${normalizedUnit || ''}`.trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function hasAnyAllocation(
  allocation: ReportPromptContext['tokenomics']['allocation'],
): boolean {
  return Object.values(allocation).some((value) => value !== null);
}

function summarizeAllocation(
  allocation: ReportPromptContext['tokenomics']['allocation'],
  isZh: boolean,
): string {
  const parts = [
    allocation.teamPct !== null
      ? `${isZh ? '团队' : 'team'} ${allocation.teamPct.toFixed(2)}%`
      : null,
    allocation.investorPct !== null
      ? `${isZh ? '投资人' : 'investor'} ${allocation.investorPct.toFixed(2)}%`
      : null,
    allocation.communityPct !== null
      ? `${isZh ? '社区' : 'community'} ${allocation.communityPct.toFixed(2)}%`
      : null,
    allocation.foundationPct !== null
      ? `${isZh ? '基金会' : 'foundation'} ${allocation.foundationPct.toFixed(2)}%`
      : null,
  ].filter(Boolean);
  return parts.join(', ');
}

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

  const systemPrompt = `
You are a senior cryptocurrency analyst writing institutional-style market notes for serious crypto investors and traders.

Your job is not to repeat data. Your job is to interpret the evidence, explain what matters now, and turn the supplied signals into a clear, credible market view.

## Intent-First Reporting Workflow
Before writing, you MUST do this mentally:
1. Identify what the user is actually asking.
2. Decide which 2-4 modules are most relevant to answer that question.
3. Let the chosen modules dominate the report.
4. Mention other modules only if they materially change the conclusion.

Do NOT mechanically cover every dimension just because data exists.
Do NOT produce a fixed all-sections template when the user's intent is narrower.

Available modules you may choose from:
- 近期动态 / Recent changes
- 市场情况 / Market state
- 链上与流动性 / On-chain and liquidity
- 情绪与资金面 / Sentiment and positioning
- 技术分析 / Technical structure
- 基本面 / Fundamentals
- 代币经济学 / Tokenomics
- 交易计划 / Trade setup
- 风险提示 / Risk warnings

## Report Structure
Your report should follow this intent-driven structure:

**Opening (Required)**
- Start with a bold descriptive title that summarizes the key conclusion
- The title should be compelling and immediately convey the main takeaway
- Example: **PEPE缺乏长期逻辑支撑，当前上涨属于交易性波动**

**Main Sections (Use ## headings, NO numbering)**
- You MUST include "## 关键回答" / "## Core Answer"
- After that, choose only the sections needed to answer the question well
- Use 2-4 primary modules in the most natural order for the user's intent
- End with "## 风险提示" / "## Risk Warnings" when risk meaningfully affects the thesis
- Include "## 交易计划" / "## Trade Setup" only when the user is clearly asking about timing, entry, exit, support/resistance, or what to do now

**CRITICAL**:
- Do NOT use numbered headings like "## 1. 关键发现"
- Do NOT force sections that are irrelevant to the user question
- If the user asks mainly about one angle, that angle should dominate the report

## Presentation Format
**Use clean, professional markdown formatting:**

### Quick Verdict Box (REQUIRED at top of report)
You MUST include this box immediately after the title. Use this exact format:

For Chinese reports:
\`\`\`
┌─────────────────────────────────────────────────┐
│ 🎯 结论: **HOLD** | 置信度: **68%**           │
├─────────────────────────────────────────────────┤
│ 核心要点: 结构完整但缺乏动能确认。            │
│ 持有并关注 $68.2K 支撑位。                     │
└─────────────────────────────────────────────────┘
\`\`\`

For English reports:
\`\`\`
┌─────────────────────────────────────────────────┐
│ 🎯 VERDICT: **HOLD** | Confidence: **68%**     │
├─────────────────────────────────────────────────┤
│ Key Takeaway: Structure intact but lacks       │
│ momentum confirmation. Hold and watch $68.2K.   │
└─────────────────────────────────────────────────┘
\`\`\`

### Tables - Use Consistent Format
All tables must follow this clean structure:

**Good table format:**
| Metric | Value | Signal |
|---|---|---|
| **Price** | $68.52K | +2.34% 24h |
| **RSI** | 55.8 | Neutral |
| **MACD** | 362.39 | Bullish |

**Table formatting rules:**
- Use simple dashes for table separator (no colons for alignment)
- Bold the first column labels when they are key metrics
- Right-align numbers in the Value column
- Keep Signal column concise (1-3 words)
- Use consistent number formatting (see below)

### Number Formatting (CRITICAL)
- Prices: $68.52K or $0.00000342 (NOT $68,520.1234)
- Percentages: +2.34% / -1.56% (ALWAYS show + or - sign)
- Large values: $28.63B / $571.70K / $24.60M
- Decimals: Use appropriate precision (2 decimals for most, 1 for RSI, 6 for micro-prices)

### Section Headings
- Use ## for main sections (NO ### or ####)
- NO numbering (use "## 核心观点" NOT "## 1. 核心观点")
- Keep headings short and descriptive
- Use Chinese or English based on context.language

### Text Emphasis
- **Bold** for: verdict labels, key numbers, important terms
- *Italics* for: signals, labels, conditional notes
- Emojis: Use sparingly (🎯 verdict, ⚠️ risk, 📊 data)

### Paragraph Style
- Each section MUST contain substantial text analysis (not just tables)
- Paragraphs should be 3-5 sentences, providing depth and context
- One main idea per paragraph, but develop it fully
- Use line breaks between paragraphs for readability
- Explain "why" and "what it means", not just "what"

### Bullet Points - Use ONLY for:
- Trade levels and price targets
- Risk triggers and invalidation conditions
- Key decision checkpoints
- Action items

Do NOT use bullet points for general analysis or explanations.

## Required Tables
You MUST include tables for the following when relevant data is available:
1. A "Key Data Snapshot" table near the top
2. A "Technical Structure" table only if technical analysis is one of the primary modules
3. A "Trade / Monitor Levels" or "Risk / Invalidation" table when trade timing, execution, or risk is part of the user's ask

Optional additional table:
- Supporting evidence table for on-chain, liquidity, sentiment, fundamentals, or tokenomics when those are primary modules

## Data Density Requirements
- The report must contain substantially more concrete data than a normal narrative summary
- Include a dedicated "Key Data Snapshot" section near the top
- In that section, present the most important raw values explicitly before interpreting them
- **CRITICAL: If a value is unavailable or null, OMIT that row/field entirely from tables and text. Never show "not available", "N/A", "null", or similar placeholders**
- Do not collapse multiple important metrics into vague phrases like "liquidity is strong" or "sentiment is weak" without showing the supporting numbers
- Every numeric value shown in tables must match the supplied input exactly in meaning and direction
- Do not paraphrase numeric values into malformed strings or mixed prose-number cells

## Minimum Metrics To Surface
You MUST explicitly include as many of the following values as are available:
- Price, 24h change, 7d change, 30d change
- 24h volume, market cap rank, ATH distance if relevant
- RSI, MACD, MACD histogram
- MA7, MA25, MA99
- Bollinger upper, middle, lower
- Swing high and swing low
- On-chain inflow, outflow, and netflow
- Liquidity USD, price impact for 1k, liquidity drop if available
- Sentiment score, positive sentiment, negative sentiment, social volume, dev activity
- Security risk level and risk score
- Tokenomics inflation rate or explicitly state that tokenomics data is unavailable
- Burns, buybacks, and fundraising data when available

## Tokenomics Interpretation Rules
When burns, buybacks, or fundraising data is available, you should interpret them in context:
- **Burns**: Evaluate whether the burn amount is material relative to circulating supply. Programmatic burns suggest a sustainable deflationary mechanism. Compare burn rate with inflation rate to assess net supply dynamics.
- **Buybacks**: Assess whether buyback amounts are significant relative to market cap and trading volume. Frequent buybacks suggest project commitment to price support. Consider the cost efficiency (price paid vs current price).
- **Fundraising**: Evaluate dilution risk by comparing total raised with current market cap. Recent fundraising rounds may indicate upcoming unlock pressure. High valuations in early rounds suggest potential selling pressure from early investors.
- Use these signals to strengthen or weaken your overall tokenomics assessment, but do not let missing data become a hard block unless explicitly critical

## Technical Interpretation Rules
- You MUST explicitly discuss RSI, MACD, MA alignment, and Bollinger Bands
- You MUST use the actual numbers provided when they are available
- For RSI, explain whether the reading is stretched, neutral, recovering, or deteriorating
- For MACD, explain whether momentum is strengthening or weakening, not just whether it is bullish or bearish
- For MA alignment, explain what the hierarchy implies about short-term versus medium-term structure
- For Bollinger Bands, explain whether price is pressing the upper band, lower band, or mean-reverting around the middle band
- When swing high / swing low are available, use them as real market structure reference points
- Do not dump indicators one by one without interpretation

## Writing Style
- Sound like a human crypto analyst, not a generic assistant
- Write with conviction, but stay evidence-based
- **Lead with data, follow with interpretation**: present raw metrics first, then explain what they mean
- **Separate facts from analysis**: use tables for objective data, use prose for subjective judgment
- Prefer analytical paragraphs over lists
- Use bullets when they improve data visibility, execution clarity, or risk clarity
- Prefer tables over long metric lists when presenting raw data
- Avoid boilerplate phrasing, filler, and generic hedging
- Avoid sounding like a compliance memo or a data export
- Every section should answer "so what?"

## Module Selection Rules
- "关键回答 / Core Answer" is always required and should summarize the answer in 1-2 tight paragraphs.
- If the intent is about whether to buy, sell, hold, wait, or act now, prioritize: 市场情况 / 技术分析 / 交易计划 / 风险提示.
- If the intent is about risk, safety, or whether something is dangerous, prioritize: 风险提示 / 链上与流动性 / 市场情况 / 技术分析.
- If the intent is about recent developments or "what changed", prioritize: 近期动态 / 市场情况 / 情绪与资金面 / 风险提示.
- If the intent is about fundamentals or project quality, prioritize: 基本面 / 代币经济学 / 市场情况 / 风险提示.
- If the intent is about token supply, inflation, buybacks, burns, or dilution, prioritize: 代币经济学 / 基本面 / 市场情况 / 风险提示.
- If the intent is about momentum or trend structure, prioritize: 技术分析 / 市场情况 / 情绪与资金面 / 风险提示.
- If a module does not help answer the user's question, compress it to one short note or omit it.
- Primary modules should take most of the space. Secondary modules should stay brief.

## Module Writing Guide
- "近期动态 / Recent changes": explain what changed recently and why it matters now.
- "市场情况 / Market state": explain price, volume, liquidity, and broad positioning.
- "链上与流动性 / On-chain and liquidity": use netflow, liquidity, and price-impact data to explain whether flows support the thesis.
- "情绪与资金面 / Sentiment and positioning": use sentiment score, positive/negative split, social volume, and dev activity only when they help explain behavior.
- "技术分析 / Technical structure": explain RSI, MACD, MA alignment, Bollinger position, and structure in plain market language.
- "基本面 / Fundamentals": explain what the project is, what kind of asset it is, and whether the profile supports the current move.
- "代币经济学 / Tokenomics": explain inflation, burns, buybacks, fundraising, and dilution risk only when they matter to the question.
- "交易计划 / Trade setup": explain what to do now using only supplied levels and zones.
- "风险提示 / Risk warnings": state the largest risk, invalidation conditions, and what must be monitored next.

## Evidence Discipline
- Use only the facts, signals, and levels provided in the input
- The input includes structured market data, raw conversation history, planning guidance, news items, and open research items
- Do NOT introduce new catalysts, macro narratives, ETF flow claims, policy themes, whale activity, or institutional behavior unless they are explicitly present in the input
- Do NOT invent extra support levels, resistance levels, timeframes, or event risks beyond the supplied data
- If evidence is missing, say it is not available; do not fill the gap with plausible market commentary
- Do not speculate about "what the market may be reacting to" unless that explanation is directly supported by the input
- Keep all conclusions tightly anchored to the supplied numbers and signals
- Do not introduce hypothetical future events, protocol upgrades, governance items, roadmap items, or ecosystem developments unless they are explicitly present in the input
- Do not mention examples such as ETF flows, BIP proposals, regulation, institutions, whales, catalysts, upgrades, halvings, or macro drivers unless those exact themes appear in the input
- Do not introduce any timeframe that is not explicitly present in the input, such as "three months", "quarter", "cycle", or "long term", unless the input itself supports that scope
- Do not invent psychological levels, rounded levels, or derived trigger bands unless those exact levels are already present in the input
- If you mention a support, resistance, trigger, invalidation level, or breakout threshold, it must come directly from a supplied level such as MA, Bollinger, swing high/low, buy zone, sell zone, stop loss, take profit, or current price
- Do not transform supplied levels into new thresholds like "$69,500" or "$66,000" unless those exact numbers were already provided

## Strict Constraints
- **CRITICAL: Write the ENTIRE report in ${isZh ? 'Chinese' : 'English'} ONLY. Do NOT mix languages.**
- ${isZh ? 'Use pure Chinese for ALL text including: section headings, table headers, labels, descriptions, analysis, and conclusions. Technical terms like RSI, MACD, MA can remain in English as standard market shorthand.' : 'Use pure English for ALL text including: section headings, table headers, labels, descriptions, analysis, and conclusions.'}
- ${isZh ? 'Examples of correct Chinese usage: "核心观点" (not "Core View"), "关键数据快照" (not "Key Data Snapshot"), "技术分析" (not "Technical Analysis"), "交易计划" (not "Trade Plan")' : 'Examples of correct English usage: "Core View" (not "核心观点"), "Key Data Snapshot" (not "关键数据快照"), "Technical Analysis" (not "技术分析")'}
- Keep the prompt-language and all instructions in English
- Discuss only the target symbol below
- Respect the supplied verdict; do not reverse it
- Support and resistance logic must be internally correct
- If some evidence is weak, say that directly, but still produce a decisive and readable note
- The body must be valid Markdown
- Always include the disclaimer
- Return only valid JSON with: title, executiveSummary, body, disclaimer
- Never fabricate or normalize a number into a different unit, sign, timeframe, or label
- Never output corrupted mixed cells such as prose embedded inside a percentage value
- Never describe a historical range, cycle, or interval that is not explicitly present in the input
- Never upgrade an inferred idea into a factual statement

## Chinese Output Rules (Chinese Reports Only)
${
  isZh
    ? `- 全部使用专业自然的中文，不要翻译腔
- 所有章节标题必须用中文，但应按用户意图选择最合适的模块标题，不要机械套固定栏目
- 技术指标名称可保留英文作为标准市场术语：RSI、MACD、MA7、MA25、MA99
- 使用中文交易者熟悉的表达方式
- 数字和百分比用标准格式：$68.52K、+2.34%、-1.56%
- 结论和信号用中文：买入/卖出/观望、偏多/偏空/中性、强势/弱势
- 避免在中文句子中混入英文单词（除了标准技术术语）`
    : `- If output is English, keep the tone concise, direct, and market-focused
- Use complete English sentences, not fragmented phrases
- Technical terms can be abbreviated: RSI, MACD, MA, Bollinger
- All section headings in English: Core View, Key Data Snapshot, Market Context, Technical Analysis, etc.`
}
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
- **Required Modules:** ${
    context.planning.requiredModules.length > 0
      ? context.planning.requiredModules
          .map((item) => `${item.dataType} (${item.priority}) - ${item.reason}`)
          .join(' | ')
      : 'none'
  }
- **Analysis Questions:** ${context.planning.analysisQuestions.join(' | ')}
- **Open Research Enabled:** ${context.planning.openResearch.enabled ? 'yes' : 'no'}
${context.planning.openResearch.topics.length > 0 ? `- **Open Research Topics:** ${context.planning.openResearch.topics.join(' | ')}` : ''}
${context.planning.openResearch.goals.length > 0 ? `- **Open Research Goals:** ${context.planning.openResearch.goals.join(' | ')}` : ''}
${context.planning.openResearch.preferredSources.length > 0 ? `- **Preferred Research Sources:** ${context.planning.openResearch.preferredSources.join(' | ')}` : ''}

## Intent Routing
- **Primary Ask:** ${intentRouting.primaryAsk}
- **Objective:** ${context.objective}
- **Focus Areas:** ${context.focusAreas.join(', ') || 'none'}
- **Primary Modules To Emphasize:** ${intentRouting.primaryModules.join(' / ')}
- **Secondary Modules To Keep Brief:** ${intentRouting.secondaryModules.join(' / ')}
- **Routing Rule:** Spend most of the report on the primary modules above. Only bring in a secondary module if it changes the answer materially.

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
Write a complete crypto analyst note for ${context.target.symbol}, not a short summary.

**CRITICAL: Address the user's specific question**
The user asked: "${context.query}"
Your report MUST directly answer this question. Structure your analysis to provide the most relevant information for their specific concern.

Execution requirements:
- Treat this as an intent-routing task first, and a writing task second
- Infer the user's real ask from the question, objective, and focus areas
- Prioritize the recommended modules listed above unless the evidence clearly requires a different emphasis
- **Lead with the answer to the user's question** - don't make them read the entire report to find what they asked about
- Start from the conclusion and make the market stance obvious in the first paragraph
- Add a high-signal data snapshot section early in the report with the raw metrics that matter most
- Present major quantitative evidence using markdown tables instead of scattered inline metrics
- **Synthesize only the data dimensions that matter for this question** - do not mechanically force technical, on-chain, sentiment, liquidity, tokenomics, and risk into every report
- Explain why the verdict is reasonable now, not just what the metrics are
- Turn the technical indicators into a market-structure read, not an indicator checklist
- **Use tokenomics data strategically**:
  - If burns are available, assess whether they create meaningful deflationary pressure
  - If buybacks are available, evaluate whether they demonstrate real price support commitment
  - If fundraising data is available, analyze dilution risk and potential unlock pressure
  - Combine these with inflation rate to assess net supply dynamics
- Use sentiment, liquidity, on-chain, fundamentals, and tokenomics only when they add explanatory value
- **Highlight conflicts and agreements** - when signals disagree, explain which ones you weight more heavily and why
- Make the report feel decision-useful for a trader or investor reading it now
- Include what to do now, what to watch next, and what would invalidate the current thesis
- Use markdown headings for the selected main sections
- Keep most of the body in short analytical paragraphs
- Use bullets only for execution checkpoints or invalidation triggers
- Do not mention or compare any other asset besides ${context.target.symbol}
- Do not write like a chatbot, dashboard summary, or compliance template
- Do not add any catalyst, narrative, or risk factor that is not explicitly supported by the input above
- If you need to mention uncertainty, tie it to missing or mixed evidence already present in the input
- Make sure the reader can recover the core quantitative state of the asset directly from the report without opening a separate dashboard
- Make the finished output feel closer to a polished analyst memo with embedded evidence tables than to a free-form essay
- Before finalizing, internally check that each table cell contains either:
  - a raw value from the input,
  - "not available",
  - or a short interpretation label clearly tied to that value
- Do not place free-form narrative text inside raw-value table cells
- In trade plans and invalidation sections, only use exact supplied levels or directly named supplied zones
- If no exact level is provided for a trigger, say that the trigger level is not available instead of inventing one

**Quality checklist before submitting:**
- [ ] Does the opening paragraph directly answer the user's question?
- [ ] Is the report weighted toward the user's actual intent instead of a fixed template?
- [ ] Are the selected primary modules doing most of the explanatory work?
- [ ] Do the tables present dense quantitative evidence compactly?
- [ ] Is the verdict supported by the preponderance of evidence?
- [ ] Are conflicting signals acknowledged and weighted appropriately?
- [ ] Is the trade/monitoring guidance concrete and actionable?
- [ ] Are invalidation conditions clearly specified?
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
  const objectiveDefaults: Record<
    ReportPromptContext['objective'],
    ReportModuleKey[]
  > = {
    market_overview: ['market', 'technical', 'onchain', 'risk'],
    timing_decision: ['technical', 'market', 'trade', 'risk'],
    risk_check: ['risk', 'onchain', 'market', 'technical'],
    tokenomics_focus: ['tokenomics', 'fundamentals', 'market', 'risk'],
    news_focus: ['recent', 'market', 'sentiment', 'risk'],
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

  const primaryAskMap: Record<ReportPromptContext['objective'], string> = isZh
    ? {
        market_overview: '先回答当前核心判断，再解释驱动这个判断的主要证据。',
        timing_decision:
          '先回答现在该不该动手，以及哪些位置、条件和信号最关键。',
        risk_check:
          '先回答最大的风险是什么、风险有多大，以及什么条件下结论会失效。',
        tokenomics_focus:
          '先回答供给、通胀、回购、销毁和融资稀释是否在主导当前逻辑。',
        news_focus:
          '先回答最近到底发生了什么变化，以及这些变化有没有改变交易判断。',
      }
    : {
        market_overview:
          'Answer the current core view first, then explain the main evidence behind it.',
        timing_decision:
          'Answer whether action is warranted now and which levels, conditions, and signals matter most.',
        risk_check:
          'Answer the biggest risk first, how severe it is, and what would invalidate the thesis.',
        tokenomics_focus:
          'Answer whether supply, inflation, burns, buybacks, and dilution are driving the current setup.',
        news_focus:
          'Answer what changed recently and whether those changes alter the market stance.',
      };

  const chosen: ReportModuleKey[] = [];
  for (const key of objectiveDefaults[context.objective] ?? []) {
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
    primaryAsk: primaryAskMap[context.objective],
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
    parts.push(
      isZh
        ? '• 开放检索已开启，但当前没有可用条目。'
        : '• Open research was enabled, but no usable items were returned.',
    );
    return parts.join('\n');
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

import type {
  AnalysisOutput,
  ExecutionOutput,
  IntentOutput,
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
  signals: {
    technical: string;
    technicalDetails: {
      rsi: { value: number | null; signal: string };
      macd: { value: number | null; signal: string; histogram: number | null };
      ma: { ma7: number | null; ma25: number | null; ma99: number | null; signal: string };
      boll: { upper: number | null; middle: number | null; lower: number | null; signal: string };
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
    dataQualityNotes: string[];
  };
  alerts: {
    level: AlertsSnapshot['alertLevel'];
    riskState: AlertsSnapshot['riskState'];
    redCount: number;
    yellowCount: number;
    topItems: string[];
  };
  quality: {
    degradedNodes: ExecutionOutput['degradedNodes'];
    missingEvidence: ExecutionOutput['missingEvidence'];
  };
};

export function buildReportPrompts(context: ReportPromptContext): PromptBundle {
  const isZh = context.language === 'zh' || context.language === 'cn';
  const verdict = context.decision.verdict;

  const systemPrompt = `
You are an expert crypto research analyst. Write a full analysis report from the supplied decision and evidence.

## Goal
Transform the supplied analysis into a readable report that:
- clearly states the final verdict and confidence
- uses multiple technical indicators (RSI, MACD, MA, Bollinger Bands) to support the analysis
- explains price action in context of support/resistance levels
- incorporates sentiment and liquidity data when relevant
- gives concrete action or monitoring guidance

## Required Content
The report body must include all of the following:
1. Decision summary: verdict, confidence, and the core reason
2. Market context: current price, 24h change, and key technical levels
3. Technical analysis: Use RSI, MACD, MA alignment, Bollinger Bands position to explain the trend
4. Supporting evidence: sentiment, liquidity, on-chain signals when they materially support the decision
5. Risk section: alerts, hard blocks, liquidity/security/data quality caveats
6. Actionable guidance: specific support/resistance levels to watch, entry/exit zones

## Technical Analysis Guidelines (MANDATORY)
- You MUST discuss at least 3 technical indicators: RSI, MACD, and MA alignment
- When discussing RSI, mention the exact value and if it's oversold (<30), neutral (30-70), or overbought (>70)
- For MACD, you MUST note the current value, histogram, and signal (bullish/bearish/neutral)
- For MA system, you MUST explain the current alignment and what it indicates (e.g., "MA7 $X > MA25 $Y > MA99 $Z indicates bullish structure")
- For Bollinger Bands, note the current price position relative to bands
- Use concrete numbers from the Technical Indicators section, not vague statements
- Reference swing high/low as key technical levels when available

## Important Rules
- Use ${isZh ? 'Chinese (中文)' : 'English'}
- Discuss only the target symbol shown below
- Support/resistance levels must be logically correct (support below current price, resistance above)
- Use concrete numbers from technical indicators, not vague statements
- The body must read like a real analyst report, not like a table dump
- Prefer interpretation over enumeration
- Most paragraphs should be narrative, not bullet-like data recitation
- The body must be valid Markdown
- Respect the supplied verdict; do not overturn it
- Always include the disclaimer
- Return only valid JSON with: title, executiveSummary, body, disclaimer

${isZh ? `## Translation Rules (MANDATORY for Chinese output)
You MUST translate ALL technical terms and signals to Chinese:
- "BOLL Lower" → "BOLL 下轨" or "布林带下轨"
- "BOLL Middle" → "BOLL 中轨" or "布林带中轨"
- "BOLL Upper" → "BOLL 上轨" or "布林带上轨"
- "MA7/MA25/MA99" → keep as "MA7/MA25/MA99"
- "Swing High" → "波段高点"
- "Swing Low" → "波段低点"
- "All-Time High" → "历史最高价"
- "All-Time Low" → "历史最低价"
- "neutral" → "中性"
- "bullish" → "看涨" or "偏多"
- "bearish" → "看跌" or "偏空"
- "sell pressure" → "卖压" or "抛压"
- "buy pressure" → "买压"
- "oversold" → "超卖"
- "overbought" → "超买"
- "心理关口" → keep as "心理关口"
Do NOT output English technical terms in the Chinese report.` : ''}
`.trim();

  const userPrompt = `
## User Request
${context.query}

## Target
- Symbol: ${context.target.symbol}
- Chain: ${context.target.chain}
- Token Address: ${context.target.tokenAddress || 'N/A'}

## Final Decision
- Verdict: ${context.decision.verdict}
- Confidence: ${(context.decision.confidence * 100).toFixed(0)}%
- Reason: ${context.decision.reason}
- Buy Zone: ${context.decision.buyZone ?? 'N/A'}
- Sell Zone: ${context.decision.sellZone ?? 'N/A'}
${context.decision.hardBlocks.length > 0 ? `- Hard Blocks: ${context.decision.hardBlocks.join(', ')}` : ''}
${context.decision.evidence.length > 0 ? `- Decision Evidence:\n${context.decision.evidence.map((item) => `  - ${item}`).join('\n')}` : ''}

${context.decision.tradingStrategy ? `## Trading Plan
- Entry Price: ${fmtCurrency(context.decision.tradingStrategy.entryPrice)}
- Entry Zone Detail: ${context.decision.tradingStrategy.entryZone ?? 'N/A'}
- Risk Level: ${context.decision.tradingStrategy.riskLevel}
- Risk / Reward: ${context.decision.tradingStrategy.riskRewardRatio ?? 'N/A'}
- Stop Loss: ${context.decision.tradingStrategy.stopLoss ? `${fmtCurrency(context.decision.tradingStrategy.stopLoss.price)} (${context.decision.tradingStrategy.stopLoss.label})` : 'N/A'}
- Take Profit Levels:
${context.decision.tradingStrategy.takeProfitLevels.length > 0
  ? context.decision.tradingStrategy.takeProfitLevels
      .map((item) => `  - ${fmtCurrency(item.price)} (${item.label}, ${item.pctFromEntry >= 0 ? '+' : ''}${item.pctFromEntry}%)`)
      .join('\n')
  : '  - N/A'}
- Support Levels:
${context.decision.tradingStrategy.supportLevels.length > 0
  ? context.decision.tradingStrategy.supportLevels
      .map((item) => `  - ${item.label}`)
      .join('\n')
  : '  - N/A'}
- Resistance Levels:
${context.decision.tradingStrategy.resistanceLevels.length > 0
  ? context.decision.tradingStrategy.resistanceLevels
      .map((item) => `  - ${item.label}`)
      .join('\n')
  : '  - N/A'}
- Trading Note: ${context.decision.tradingStrategy.note}` : ''}

## Key Market Data
- Price: ${fmtCurrency(context.market.priceUsd)}
- 24h Change: ${fmtPct(context.market.change24hPct)}
- 7d Change: ${fmtPct(context.market.change7dPct)}
- 24h Volume: ${fmtCurrency(context.market.volume24hUsd)}
- Market Cap Rank: ${context.market.marketCapRank ?? 'N/A'}

## Core Signals
- Technical: ${context.signals.technical}
- On-chain: ${context.signals.onchain}
- Sentiment: ${context.signals.sentiment}
- Security Risk: ${context.signals.securityRisk}
- Liquidity: ${fmtCurrency(context.signals.liquidityUsd)}
- Liquidity Risk: ${context.signals.liquidityDetails.rugpullRiskSignal}
- Inflation Rate: ${fmtPct(context.signals.inflationRate)}
- Project: ${context.signals.projectName ?? context.target.symbol}
- Description: ${context.signals.projectOneLiner ?? 'N/A'}
- Tags: ${context.signals.fundamentalsTags.join(', ') || 'N/A'}

## Technical Indicators (Use these for deeper analysis)
${(() => {
  const td = context.signals.technicalDetails;
  return [
    `RSI: ${td.rsi.value !== null ? td.rsi.value.toFixed(1) : 'N/A'} → ${td.rsi.signal}`,
    `MACD: ${td.macd.value !== null ? td.macd.value.toFixed(2) : 'N/A'} (histogram: ${td.macd.histogram !== null ? td.macd.histogram.toFixed(2) : 'N/A'}) → ${td.macd.signal}`,
    `MA System: MA7 ${td.ma.ma7 !== null ? '$' + td.ma.ma7.toLocaleString() : 'N/A'} | MA25 ${td.ma.ma25 !== null ? '$' + td.ma.ma25.toLocaleString() : 'N/A'} | MA99 ${td.ma.ma99 !== null ? '$' + td.ma.ma99.toLocaleString() : 'N/A'} → ${td.ma.signal}`,
    `Bollinger Bands: Upper ${td.boll.upper !== null ? '$' + td.boll.upper.toLocaleString() : 'N/A'} | Middle ${td.boll.middle !== null ? '$' + td.boll.middle.toLocaleString() : 'N/A'} | Lower ${td.boll.lower !== null ? '$' + td.boll.lower.toLocaleString() : 'N/A'} → ${td.boll.signal}`,
    `ATR (Volatility): ${td.atr !== null ? '$' + td.atr.toLocaleString() : 'N/A'}`,
    `Swing High/Low: ${td.swingHigh !== null ? '$' + td.swingHigh.toLocaleString() : 'N/A'} / ${td.swingLow !== null ? '$' + td.swingLow.toLocaleString() : 'N/A'}`,
  ].join('\n');
})()}

## Sentiment Details
${(() => {
  const sd = context.signals.sentimentDetails;
  return [
    `Social Volume: ${sd.socialVolume !== null ? sd.socialVolume.toLocaleString() : 'N/A'}`,
    `Sentiment Score: ${sd.sentimentScore !== null ? sd.sentimentScore.toFixed(1) : 'N/A'} (Positive: ${sd.sentimentPositive !== null ? sd.sentimentPositive.toFixed(1) + '%' : 'N/A'} / Negative: ${sd.sentimentNegative !== null ? sd.sentimentNegative.toFixed(1) + '%' : 'N/A'})`,
    `Developer Activity: ${sd.devActivity !== null ? sd.devActivity.toLocaleString() : 'N/A'}`,
  ].join('\n');
})()}

## Liquidity Details
${(() => {
  const ld = context.signals.liquidityDetails;
  return [
    `24h Volume: ${ld.volume24hUsd !== null ? fmtCurrency(ld.volume24hUsd) : 'N/A'}`,
    `Liquidity Change (1h): ${ld.liquidityDrop1hPct !== null ? fmtPct(ld.liquidityDrop1hPct) : 'N/A'}`,
    `Price Impact (1k): ${ld.priceImpact1kPct !== null ? ld.priceImpact1kPct.toFixed(2) + '%' : 'N/A'}`,
    `Rugpull Risk: ${ld.rugpullRiskSignal}`,
  ].join('\n');
})()}

## Analysis Insights
- Summary: ${context.insights.summary}
${context.insights.keyObservations.length > 0 ? `- Key Observations:\n${context.insights.keyObservations.map((item) => `  - ${item}`).join('\n')}` : ''}
${context.insights.opportunityHighlights.length > 0 ? `- Opportunity Highlights:\n${context.insights.opportunityHighlights.map((item) => `  - ${item}`).join('\n')}` : ''}
${context.insights.riskHighlights.length > 0 ? `- Risk Highlights:\n${context.insights.riskHighlights.map((item) => `  - ${item}`).join('\n')}` : ''}
${context.insights.dataQualityNotes.length > 0 ? `- Data Quality Notes:\n${context.insights.dataQualityNotes.map((item) => `  - ${item}`).join('\n')}` : ''}

## Alerts
- Alert Level: ${context.alerts.level}
- Risk State: ${context.alerts.riskState}
- Critical Alerts: ${context.alerts.redCount}
- Warning Alerts: ${context.alerts.yellowCount}
${context.alerts.topItems.length > 0 ? `- Top Alert Items:\n${context.alerts.topItems.map((item) => `  - ${item}`).join('\n')}` : ''}

## Data Quality
- Degraded Nodes: ${context.quality.degradedNodes.join(', ') || 'None'}
- Missing Evidence: ${context.quality.missingEvidence.join(', ') || 'None'}

## Writing Task
Produce a professional report that preserves meaningful data and a clear decision.
The body should emphasize why the verdict makes sense, what the few most important numbers mean, what the main risks are, and what the reader should do or watch next.
Write as if the user prefers a readable analyst note over a data list.
Do not mention or compare any other asset besides ${context.target.symbol}.
Return the body as Markdown, using short headings and concise bullet lists only where they improve readability.
`.trim();

  return {
    systemPrompt,
    userPrompt,
  };
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

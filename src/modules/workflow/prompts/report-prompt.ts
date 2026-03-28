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
    onchain: string;
    sentiment: string;
    securityRisk: string;
    liquidityUsd: number | null;
    liquidityRisk: string;
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
  const isZh = context.language === 'zh';
  const verdict = context.decision.verdict;

  const systemPrompt = `
You are an expert crypto research analyst. Write a full analysis report from the supplied decision and evidence.

## Goal
Transform the supplied analysis into a readable report that:
- clearly states the final verdict and confidence
- cites only the most meaningful market data and risk signals
- explains why the verdict follows from the evidence
- gives concrete action or monitoring guidance

## Required Content
The report body must include all of the following:
1. Decision summary: verdict, confidence, and the core reason
2. Meaningful data: price, 24h move, and only a few other useful metrics/signals if they materially help
3. Supporting evidence: the strongest observations behind the decision
4. Risk section: alerts, hard blocks, liquidity/security/data quality caveats
5. Actionable guidance: buy zone / sell zone / watch levels / what to monitor next

## Important Rules
- Use ${isZh ? 'Chinese (中文)' : 'English'}
- Do not restate every raw field; select only the most decision-relevant data
- The body must read like a real analyst report, not like a table dump
- Prefer interpretation over enumeration
- Mention concrete numbers only when they materially support the conclusion
- Most paragraphs should be narrative, not bullet-like data recitation
- The body must be valid Markdown
- Respect the supplied verdict; do not overturn it
- If data quality is degraded, say how that affects confidence
- Always include the disclaimer
- Return only valid JSON with: title, executiveSummary, body, disclaimer
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
- Liquidity Risk: ${context.signals.liquidityRisk}
- Inflation Rate: ${fmtPct(context.signals.inflationRate)}
- Project: ${context.signals.projectName ?? context.target.symbol}
- Description: ${context.signals.projectOneLiner ?? 'N/A'}
- Tags: ${context.signals.fundamentalsTags.join(', ') || 'N/A'}

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

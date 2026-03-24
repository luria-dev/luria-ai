import type {
  ExecutionOutput,
  IntentOutput,
  PlanOutput,
} from '../../../data/contracts/workflow-contracts';
import type { AlertsSnapshot } from '../../../data/contracts/analyze-contracts';
import { PromptBundle } from './prompt-types';

export type AnalysisPromptContext = {
  analysisMode: 'standard' | 'degraded';
  degradedReason: string | null;
  intent: {
    query: IntentOutput['userQuery'];
    language: IntentOutput['language'];
    taskType: IntentOutput['taskType'];
    objective: IntentOutput['objective'];
    sentimentBias: IntentOutput['sentimentBias'];
    entities: IntentOutput['entities'];
    focusAreas: IntentOutput['focusAreas'];
  };
  analysisQuestions: PlanOutput['analysisQuestions'];
  evidence: {
    price: {
      priceUsd: number | null;
      change1hPct: number | null;
      change24hPct: number | null;
      change7dPct: number | null;
      change30dPct: number | null;
      marketCapRank: number | null;
      circulatingSupply: number | null;
      totalSupply: number | null;
      maxSupply: number | null;
      fdvUsd: number | null;
      totalVolume24hUsd: number | null;
      athUsd: number | null;
      atlUsd: number | null;
      athChangePct: number | null;
      atlChangePct: number | null;
      degraded: boolean;
    };
    technical: {
      summarySignal: string;
      rsi: number | null;
      macdSignal: string;
      degraded: boolean;
    };
    onchain: {
      signal: string;
      netflowUsd: number | null;
      inflowUsd: number | null;
      outflowUsd: number | null;
      exchanges: Array<{
        exchange: string;
        netflowUsd: number | null;
        inflowUsd: number | null;
        outflowUsd: number | null;
      }>;
      degraded: boolean;
    };
    security: {
      riskLevel: string;
      isHoneypot: boolean | null;
      canTradeSafely: boolean | null;
      holderCount: number | null;
      isInCex: boolean | null;
      degraded: boolean;
    };
    liquidity: {
      liquidityUsd: number | null;
      volume24hUsd: number | null;
      withdrawalRiskFlag: boolean;
      rugpullRiskSignal: string;
      quoteToken: string;
      hasUsdtOrUsdcPair: boolean;
      priceImpact1kPct: number | null;
      degraded: boolean;
    };
    tokenomics: {
      teamPct: number | null;
      investorPct: number | null;
      communityPct: number | null;
      foundationPct: number | null;
      inflationRate: number | null;
      vestingCount: number;
      tokenomicsEvidenceInsufficient: boolean;
      degraded: boolean;
    };
    fundamentals: {
      profile: {
        name: string | null;
        oneLiner: string | null;
        establishmentDate: string | null;
        active: boolean | null;
        tags: string[];
        rtScore: number | null;
        tvlScore: number | null;
        similarProjects: string[];
      };
      teamCount: number;
      investorCount: number;
      fundraisingCount: number;
      lastFundraisingRound: string | null;
      lastFundraisingAmount: number | null;
      ecosystems: string[];
      social: {
        heatRank: number | null;
        influenceRank: number | null;
        followers: number | null;
      };
      degraded: boolean;
    };
    sentiment: {
      signal: string;
      sentimentScore: number | null;
      socialVolume: number | null;
      socialDominance: number | null;
      devActivity: number | null;
      githubActivity: number | null;
      degraded: boolean;
    };
    news: Array<{
      title: string;
      source: string;
      publishedAt: string;
      category: string | null;
      relevanceScore: number;
    }>;
  };
  alerts: {
    level: AlertsSnapshot['alertLevel'];
    redCount: number;
    yellowCount: number;
    riskState: AlertsSnapshot['riskState'];
    items: AlertsSnapshot['items'];
  };
  dataQuality: {
    degradedNodes: ExecutionOutput['degradedNodes'];
    missingEvidence: ExecutionOutput['missingEvidence'];
  };
  outputPolicy: {
    noHallucination: boolean;
    mentionSourceLimits: boolean;
    respectHardRiskControls: boolean;
    comparisonMode: string;
  };
};

export function buildAnalysisPrompts(
  context: AnalysisPromptContext,
): PromptBundle {
  const isComparison = context.intent.taskType === 'comparison';
  const isZh = context.intent.language === 'zh';
  const isDegraded = context.analysisMode === 'degraded';

  const modeRules = isComparison
    ? [
        'Comparison mode: analyze only the current target.',
        'Do not declare the final winner in this node.',
      ]
    : ['Single-target analysis mode.'];

  const degradedRules = isDegraded
    ? [
        'Degraded analysis mode: core evidence is incomplete, so this is a constrained advisory readout.',
        'You may ONLY output verdict = HOLD, CAUTION, or INSUFFICIENT_DATA.',
        'Confidence MUST be 0.55 or lower.',
        'buyZone MUST be null and sellZone MUST be null.',
        'Do not convert partial evidence into a strong directional trade call.',
        'Prioritize what is known, what is missing, and what confirmation is required next.',
      ]
    : [];

  const systemPrompt = `
You are a crypto research advisor. Synthesize the evidence into one combined advisory decision.

## What You Must Produce
Return ONLY valid JSON with:
- verdict
- confidence
- reason
- buyZone
- sellZone
- evidence
- summary
- keyObservations
- riskHighlights
- opportunityHighlights
- dataQualityNotes

## Required JSON Field Types
- evidence: array of strings
- keyObservations: array of strings
- riskHighlights: array of strings
- opportunityHighlights: array of strings
- dataQualityNotes: array of strings
- Never return these five fields as a plain string.

## Decision Rules
- Security and liquidity red flags carry the highest weight.
- If evidence is materially degraded or missing, lower confidence and use INSUFFICIENT_DATA when appropriate.
- Use actual numbers from the evidence whenever possible.
- Keep keyObservations to 5-8 items.
- Keep riskHighlights, opportunityHighlights, and dataQualityNotes concise and evidence-based.
- Do not invent catalysts, support levels, or data that are not present.

## Verdict Guidance
- BUY: evidence is broadly constructive and risk/reward is favorable.
- SELL: risk dominates, bearish signals are clear, or tradeability is poor.
- HOLD: mixed signals, no strong directional edge.
- CAUTION: concerns are meaningful but not severe enough for SELL.
- INSUFFICIENT_DATA: missing or degraded evidence prevents a reliable directional call.

## Style
- Respond in ${isZh ? 'Chinese (中文)' : 'English'}.
- summary should read like an advisor's view, not a data dump.
- reason should be direct and decision-oriented.
- evidence should be short factual bullets.

## Important Constraints
${modeRules.join('\n')}
${context.outputPolicy.respectHardRiskControls ? '- Respect hard risk controls implied by security, liquidity, and degraded core evidence.' : ''}
${degradedRules.join('\n')}
`.trim();

  const userPrompt = `
## User Request
${context.intent.query}

## Intent
- Objective: ${context.intent.objective}
- Focus Areas: ${context.intent.focusAreas.join(', ') || 'none'}
- Sentiment Bias: ${context.intent.sentimentBias}
- Analysis Mode: ${context.analysisMode}
${isDegraded ? `- Degraded Reason: ${context.degradedReason ?? 'Core evidence is incomplete.'}` : ''}

## Questions To Answer
${context.analysisQuestions.map((question) => `- ${question}`).join('\n')}

## Evidence

### Price
- Price: $${fmtNum(context.evidence.price.priceUsd)}
- 1h: ${fmtPct(context.evidence.price.change1hPct)}
- 24h: ${fmtPct(context.evidence.price.change24hPct)}
- 7d: ${fmtPct(context.evidence.price.change7dPct)}
- 30d: ${fmtPct(context.evidence.price.change30dPct)}
- Market Cap Rank: #${context.evidence.price.marketCapRank ?? 'N/A'}
- 24h Volume: $${fmtNum(context.evidence.price.totalVolume24hUsd)}
- ATH Distance: ${fmtPct(context.evidence.price.athChangePct)}
${context.evidence.price.degraded ? '- Price data degraded.' : ''}

### Technical
- Summary Signal: ${context.evidence.technical.summarySignal}
- RSI: ${context.evidence.technical.rsi ?? 'N/A'}
- MACD Signal: ${context.evidence.technical.macdSignal}
${context.evidence.technical.degraded ? '- Technical data degraded.' : ''}

### On-chain
- Signal: ${context.evidence.onchain.signal}
- Netflow: $${fmtNum(context.evidence.onchain.netflowUsd)}
- Inflow: $${fmtNum(context.evidence.onchain.inflowUsd)}
- Outflow: $${fmtNum(context.evidence.onchain.outflowUsd)}
${context.evidence.onchain.exchanges.length > 0 ? context.evidence.onchain.exchanges.slice(0, 5).map((item) => `- ${item.exchange}: net $${fmtNum(item.netflowUsd)}, in $${fmtNum(item.inflowUsd)}, out $${fmtNum(item.outflowUsd)}`).join('\n') : '- No exchange breakdown.'}
${context.evidence.onchain.degraded ? '- On-chain data degraded.' : ''}

### Security
- Risk Level: ${context.evidence.security.riskLevel}
- Honeypot: ${boolLabel(context.evidence.security.isHoneypot)}
- Safe To Trade: ${boolLabel(context.evidence.security.canTradeSafely)}
- Holder Count: ${fmtNum(context.evidence.security.holderCount)}
- CEX Listed: ${boolLabel(context.evidence.security.isInCex)}
${context.evidence.security.degraded ? '- Security data degraded.' : ''}

### Liquidity
- Liquidity: $${fmtNum(context.evidence.liquidity.liquidityUsd)}
- 24h Volume: $${fmtNum(context.evidence.liquidity.volume24hUsd)}
- Rugpull Risk: ${context.evidence.liquidity.rugpullRiskSignal}
- Withdrawal Risk: ${context.evidence.liquidity.withdrawalRiskFlag ? 'YES' : 'No'}
- Quote Token: ${context.evidence.liquidity.quoteToken}
- USDT/USDC Pair: ${context.evidence.liquidity.hasUsdtOrUsdcPair ? 'Yes' : 'No'}
- Price Impact (1K): ${fmtPct(context.evidence.liquidity.priceImpact1kPct)}
${context.evidence.liquidity.degraded ? '- Liquidity data degraded.' : ''}

### Tokenomics
- Team: ${fmtPct(context.evidence.tokenomics.teamPct)}
- Investors: ${fmtPct(context.evidence.tokenomics.investorPct)}
- Community: ${fmtPct(context.evidence.tokenomics.communityPct)}
- Foundation: ${fmtPct(context.evidence.tokenomics.foundationPct)}
- Inflation: ${fmtPct(context.evidence.tokenomics.inflationRate)}
- Vesting Events: ${context.evidence.tokenomics.vestingCount}
${context.evidence.tokenomics.tokenomicsEvidenceInsufficient ? '- Tokenomics evidence insufficient.' : ''}
${context.evidence.tokenomics.degraded ? '- Tokenomics data degraded.' : ''}

### Fundamentals
- Project: ${context.evidence.fundamentals.profile.name ?? 'Unknown'}
- One-Liner: ${context.evidence.fundamentals.profile.oneLiner ?? 'N/A'}
- Established: ${context.evidence.fundamentals.profile.establishmentDate ?? 'Unknown'}
- Active: ${boolLabel(context.evidence.fundamentals.profile.active)}
- Tags: ${context.evidence.fundamentals.profile.tags.join(', ') || 'None'}
- RT Score: ${context.evidence.fundamentals.profile.rtScore ?? 'N/A'}
- TVL Score: ${context.evidence.fundamentals.profile.tvlScore ?? 'N/A'}
- Team Members: ${context.evidence.fundamentals.teamCount}
- Investors: ${context.evidence.fundamentals.investorCount}
- Funding Rounds: ${context.evidence.fundamentals.fundraisingCount}
- Ecosystems: ${context.evidence.fundamentals.ecosystems.join(', ') || 'None'}
${context.evidence.fundamentals.degraded ? '- Fundamentals data degraded.' : ''}

### Sentiment
- Signal: ${context.evidence.sentiment.signal}
- Score: ${context.evidence.sentiment.sentimentScore ?? 'N/A'}
- Social Volume: ${fmtNum(context.evidence.sentiment.socialVolume)}
- Social Dominance: ${fmtPct(context.evidence.sentiment.socialDominance)}
- Dev Activity: ${context.evidence.sentiment.devActivity ?? 'N/A'}
- GitHub Activity: ${context.evidence.sentiment.githubActivity ?? 'N/A'}
${context.evidence.sentiment.degraded ? '- Sentiment data degraded.' : ''}

### News
${context.evidence.news.length > 0 ? context.evidence.news.map((item) => `- [${item.source}] ${item.title} (${item.category ?? 'general'}, ${item.relevanceScore})`).join('\n') : '- No recent news evidence.'}

### Alerts
- Alert Level: ${context.alerts.level}
- Critical: ${context.alerts.redCount}
- Warning: ${context.alerts.yellowCount}
- Risk State: ${context.alerts.riskState}
${context.alerts.items.length > 0 ? context.alerts.items.map((item) => `- [${item.severity}] ${item.code}: ${item.message}`).join('\n') : '- No active alert details.'}

### Data Quality
${context.dataQuality.degradedNodes.length > 0 ? `- Degraded nodes: ${context.dataQuality.degradedNodes.join(', ')}` : '- No degraded nodes.'}
${context.dataQuality.missingEvidence.length > 0 ? `- Missing evidence: ${context.dataQuality.missingEvidence.join(', ')}` : '- No missing evidence.'}

## Task
Produce one combined advisory decision from the evidence above. Return ONLY valid JSON.

## JSON Skeleton
{
  "verdict": "INSUFFICIENT_DATA",
  "confidence": 0.45,
  "reason": "string",
  "buyZone": null,
  "sellZone": null,
  "evidence": ["string"],
  "summary": "string",
  "keyObservations": ["string"],
  "riskHighlights": ["string"],
  "opportunityHighlights": [],
  "dataQualityNotes": ["string"]
}
`.trim();

  return {
    systemPrompt,
    userPrompt,
  };
}

function fmtNum(value: number | null): string {
  if (value === null) return 'N/A';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

function fmtPct(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function boolLabel(value: boolean | null): string {
  if (value === null) return 'Unknown';
  return value ? 'Yes' : 'No';
}

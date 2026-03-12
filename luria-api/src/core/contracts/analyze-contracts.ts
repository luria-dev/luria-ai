export type AnalyzeCandidate = {
  candidateId: string;
  targetKey?: string;
  tokenName: string;
  symbol: string;
  chain: string;
  tokenAddress: string;
  quoteToken: 'USDT' | 'USDC';
  pairAddress: string;
  sourceId: string;
};

export type AnalyzeIdentity = {
  symbol: string;
  chain: string;
  tokenAddress: string;
  pairAddress: string;
  quoteToken: 'USDT' | 'USDC';
  sourceId: string;
};

export type PriceSnapshot = {
  priceUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  asOf: string;
  sourceUsed:
    | 'dexscreener'
    | 'coingecko'
    | 'dexscreener+coingecko'
    | 'market_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: 'market' | 'project' | 'partnership' | 'listing' | 'security' | 'macro';
  relevanceScore: number;
};

export type NewsSnapshot = {
  items: NewsItem[];
  asOf: string;
  sourceUsed: 'news_mock' | 'news_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type TokenAllocation = {
  teamPct: number | null;
  investorPct: number | null;
  communityPct: number | null;
  foundationPct: number | null;
};

export type VestingItem = {
  bucket: string;
  start: string;
  cliffMonths: number;
  unlockFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  end: string;
};

export type InflationRate = {
  currentAnnualPct: number | null;
  targetAnnualPct: number | null;
  isDynamic: boolean;
};

export type TokenomicsEvidence = {
  field: string;
  sourceName: 'messari' | 'coingecko' | 'tokenomist';
  sourceUrl: string;
  extractedAt: string;
};

export type TokenomicsConflict = {
  field: string;
  chosenSource: 'messari' | 'coingecko' | 'tokenomist';
  droppedSource: 'messari' | 'coingecko' | 'tokenomist';
  reason: string;
};

export type TokenomicsSnapshot = {
  allocation: TokenAllocation;
  vestingSchedule: VestingItem[];
  inflationRate: InflationRate;
  evidence: TokenomicsEvidence[];
  evidenceConflicts: TokenomicsConflict[];
  asOf: string;
  sourceUsed: Array<'messari' | 'coingecko' | 'tokenomist'>;
  degraded: boolean;
  degradeReason?: string;
  tokenomicsEvidenceInsufficient: boolean;
};

export type RsiIndicator = {
  period: number;
  value: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
};

export type MacdIndicator = {
  macd: number | null;
  signalLine: number | null;
  histogram: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
};

export type MaIndicator = {
  ma7: number | null;
  ma25: number | null;
  ma99: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
};

export type BollIndicator = {
  upper: number | null;
  middle: number | null;
  lower: number | null;
  bandwidth: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
};

export type TechnicalSnapshot = {
  rsi: RsiIndicator;
  macd: MacdIndicator;
  ma: MaIndicator;
  boll: BollIndicator;
  summarySignal: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  asOf: string;
  sourceUsed: 'coingecko' | 'technical_mock' | 'technical_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type ExchangeNetflow = {
  exchange: string;
  inflowUsd: number | null;
  outflowUsd: number | null;
  netflowUsd: number | null;
};

export type CexNetflowSnapshot = {
  window: '24h' | '7d';
  inflowUsd: number | null;
  outflowUsd: number | null;
  netflowUsd: number | null;
  signal: 'buy_pressure' | 'sell_pressure' | 'neutral';
  exchanges: ExchangeNetflow[];
  asOf: string;
  sourceUsed: Array<'coinglass' | 'santiment'>;
  degraded: boolean;
  degradeReason?: string;
};

export type SecurityRiskItem = {
  code:
    | 'HONEYPOT'
    | 'OWNER_NOT_RENOUNCED'
    | 'BLACKLIST_FUNCTION'
    | 'MINT_FUNCTION'
    | 'TRADING_COOLDOWN'
    | 'UNKNOWN';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
};

export type SecuritySnapshot = {
  isContractOpenSource: boolean | null;
  isHoneypot: boolean | null;
  isOwnerRenounced: boolean | null;
  riskScore: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  riskItems: SecurityRiskItem[];
  canTradeSafely: boolean | null;
  asOf: string;
  sourceUsed: 'goplus' | 'security_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type LiquiditySnapshot = {
  quoteToken: 'USDT' | 'USDC' | 'OTHER';
  hasUsdtOrUsdcPair: boolean;
  pairAddress: string | null;
  liquidityUsd: number | null;
  liquidity1hAgoUsd: number | null;
  liquidityDrop1hPct: number | null;
  withdrawalRiskFlag: boolean;
  volume24hUsd: number | null;
  priceImpact1kPct: number | null;
  isLpLocked: boolean | null;
  lpLockRatioPct: number | null;
  rugpullRiskSignal: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  warnings: string[];
  asOf: string;
  sourceUsed: 'dexscreener' | 'liquidity_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertItem = {
  code:
    | 'SECURITY_HONEYPOT'
    | 'SECURITY_HIGH_RISK'
    | 'LIQUIDITY_HIGH_RISK'
    | 'PRICE_ABNORMAL_VOLATILITY'
    | 'CEX_SELL_PRESSURE'
    | 'TOKENOMICS_EVIDENCE_MISSING'
    | 'DATA_DEGRADED';
  severity: AlertSeverity;
  message: string;
};

export type AlertsSnapshot = {
  alertLevel: 'info' | 'yellow' | 'red';
  alertType: Array<
    | 'security_redline'
    | 'liquidity_withdrawal_risk'
    | 'price_abnormal_volatility'
    | 'cex_inflow_spike'
    | 'tokenomics_evidence_missing'
    | 'data_degraded'
  >;
  riskState: 'normal' | 'elevated' | 'emergency';
  redCount: number;
  yellowCount: number;
  items: AlertItem[];
  asOf: string;
};

export type StrategyVerdict = 'BUY' | 'SELL' | 'HOLD' | 'CAUTION' | 'INSUFFICIENT_DATA';

export type StrategySnapshot = {
  verdict: StrategyVerdict;
  confidence: number;
  reason: string;
  buyZone: string | null;
  sellZone: string | null;
  hardBlocks: string[];
  evidence: string[];
  asOf: string;
};

export type AnalyzeBootstrapAcceptedResponse = {
  status: 'accepted';
  requestId: string;
  nextAction: 'run_pipeline' | 'select_candidate';
  message: string;
  candidates?: AnalyzeCandidate[];
  payload?: Record<string, unknown>;
};

export type AnalyzeBootstrapFailedResponse = {
  status: 'failed';
  requestId: string;
  errorCode: 'NOT_FOUND';
  message: string;
};

export type AnalyzeBootstrapResponse =
  | AnalyzeBootstrapAcceptedResponse
  | AnalyzeBootstrapFailedResponse;

export type AnalyzeSelectResponse = {
  status: 'accepted' | 'failed';
  requestId: string;
  nextAction: 'selection_recorded' | 'invalid_selection';
  message: string;
  errorCode?: 'REQUEST_NOT_FOUND' | 'INVALID_SELECTION' | 'TARGET_KEY_REQUIRED';
  payload?: Record<string, unknown>;
};

export type AnalyzeResultResponse = {
  status: 'pending' | 'waiting_selection' | 'ready' | 'failed';
  requestId: string;
  message: string;
  payload: Record<string, unknown>;
};

export type ModuleReadiness = {
  module: string;
  state: 'skeleton_ready';
};

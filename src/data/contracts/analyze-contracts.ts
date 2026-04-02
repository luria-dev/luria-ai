export type AnalyzeCandidate = {
  candidateId: string;
  targetKey?: string;
  tokenName: string;
  symbol: string;
  chain: string;
  tokenAddress: string;
  quoteToken: 'USDT' | 'USDC' | 'OTHER';
  sourceId: string;
};

export type AnalyzeIdentity = {
  symbol: string;
  chain: string;
  tokenAddress: string;
  sourceId: string;
};

export type PriceSnapshot = {
  priceUsd: number | null;
  marketCapUsd?: number | null;
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
  asOf: string;
  sourceUsed: 'coingecko' | 'coinmarketcap' | 'market_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category:
    | 'market'
    | 'project'
    | 'partnership'
    | 'listing'
    | 'security'
    | 'macro';
  relevanceScore: number;
};

export type NewsSnapshot = {
  items: NewsItem[];
  asOf: string;
  sourceUsed: 'coindesk' | 'messari' | 'news_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type OpenResearchItem = {
  title: string;
  url: string;
  source: string;
  snippet: string | null;
  publishedAt: string | null;
  topic: string;
  relevanceScore: number;
};

export type OpenResearchSnapshot = {
  enabled: boolean;
  query: string;
  topics: string[];
  goals: string[];
  preferredSources: string[];
  takeaways: string[];
  items: OpenResearchItem[];
  asOf: string;
  sourceUsed: string[];
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
  sourceName: 'tokenomist' | 'rootdata';
  sourceUrl: string;
  extractedAt: string;
};

export type TokenomicsConflict = {
  field: string;
  chosenSource: 'tokenomist' | 'rootdata';
  droppedSource: 'tokenomist' | 'rootdata';
  reason: string;
};

export type BurnEvent = {
  burnEventLabel: string;
  burnType: string;
  burnDate: string;
  amount: number;
  metadata: {
    burners: string[];
    burnReasons: string[];
  };
};

export type BuybackEvent = {
  buybackEventLabel: string;
  buybackType: string;
  buybackDate: string;
  tokenAmount: number;
  value: number;
  spentAmount: number;
  spentUnit: string;
};

export type FundraisingRound = {
  roundName: string;
  fundingDate: string;
  amountRaised: number;
  currency: string;
  valuation: number | null;
  investors: string[];
};

export type TokenomicsSnapshot = {
  allocation: TokenAllocation;
  vestingSchedule: VestingItem[];
  inflationRate: InflationRate;
  burns: {
    totalBurnAmount: number | null;
    recentBurns: BurnEvent[];
  };
  buybacks: {
    totalBuybackAmount: number | null;
    recentBuybacks: BuybackEvent[];
  };
  fundraising: {
    totalRaised: number | null;
    rounds: FundraisingRound[];
  };
  evidence: TokenomicsEvidence[];
  evidenceConflicts: TokenomicsConflict[];
  asOf: string;
  sourceUsed: Array<'tokenomist' | 'rootdata'>;
  degraded: boolean;
  degradeReason?: string;
  tokenomicsEvidenceInsufficient: boolean;
};

export type FundamentalsProfile = {
  projectId: number | null;
  name: string | null;
  tokenSymbol: string | null;
  oneLiner: string | null;
  description: string | null;
  establishmentDate: string | null;
  active: boolean | null;
  logoUrl: string | null;
  rootdataUrl: string | null;
  tags: string[];
  totalFundingUsd: number | null;
  rtScore: number | null;
  tvlScore: number | null;
  similarProjects: string[];
};

export type FundamentalsTeamMember = {
  name: string;
  position: string | null;
};

export type FundamentalsInvestor = {
  name: string;
  type: string | null;
  logoUrl: string | null;
};

export type FundamentalsFundraisingRound = {
  round: string | null;
  amountUsd: number | null;
  valuationUsd: number | null;
  publishedAt: string | null;
  investors: string[];
};

export type FundamentalsEcosystem = {
  ecosystems: string[];
  onMainNet: string[];
  onTestNet: string[];
  planToLaunch: string[];
};

export type FundamentalsSocial = {
  heat: number | null;
  heatRank: number | null;
  influence: number | null;
  influenceRank: number | null;
  followers: number | null;
  following: number | null;
  hotIndexScore: number | null;
  hotIndexRank: number | null;
  xHeatScore: number | null;
  xHeatRank: number | null;
  xInfluenceScore: number | null;
  xInfluenceRank: number | null;
  xFollowersScore: number | null;
  xFollowersRank: number | null;
  socialLinks: string[];
};

export type FundamentalsSnapshot = {
  profile: FundamentalsProfile;
  team: FundamentalsTeamMember[];
  investors: FundamentalsInvestor[];
  fundraising: FundamentalsFundraisingRound[];
  ecosystems: FundamentalsEcosystem;
  social: FundamentalsSocial;
  asOf: string;
  sourceUsed: Array<'rootdata'>;
  degraded: boolean;
  degradeReason?: string;
};

export type SentimentSnapshot = {
  socialVolume: number | null;
  socialDominance: number | null;
  sentimentPositive: number | null;
  sentimentNegative: number | null;
  sentimentBalanced: number | null;
  sentimentScore: number | null;
  devActivity: number | null;
  githubActivity: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
  asOf: string;
  sourceUsed: 'santiment' | 'sentiment_unavailable';
  degraded: boolean;
  degradeReason?: string;
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
  atr: { value: number | null; period: number }; // Average True Range
  swingHigh: number | null; // recent local high
  swingLow: number | null; // recent local low
  summarySignal: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  asOf: string;
  sourceUsed: 'coingecko' | 'coinmarketcap' | 'technical_unavailable';
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
  window: '24h' | '7d' | '30d' | '60d';
  inflowUsd: number | null;
  outflowUsd: number | null;
  netflowUsd: number | null;
  signal: 'buy_pressure' | 'sell_pressure' | 'neutral';
  exchanges: ExchangeNetflow[];
  asOf: string;
  sourceUsed: Array<'santiment' | 'coinglass' | 'glassnode'>;
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
    | 'SELFDESTRUCT'
    | 'HONEYPOT_CREATOR'
    | 'TRUST_LIST_MISSING'
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
  // holder data
  holderCount: number | null;
  lpHolderCount: number | null;
  creatorPercent: number | null;
  ownerPercent: number | null;
  // listing status
  isInCex: boolean | null;
  cexList: string[];
  isInDex: boolean | null;
  // additional risk flags
  transferPausable: boolean | null;
  selfdestruct: boolean | null;
  externalCall: boolean | null;
  honeypotWithSameCreator: boolean | null;
  trustList: boolean | null;
  isAntiWhale: boolean | null;
  transferTax: number | null;
  asOf: string;
  sourceUsed: 'goplus' | 'blockaid' | 'security_unavailable';
  degraded: boolean;
  degradeReason?: string;
};

export type LiquiditySnapshot = {
  quoteToken: 'USDT' | 'USDC' | 'OTHER';
  hasUsdtOrUsdcPair: boolean;
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
  sourceUsed:
    | 'geckoterminal'
    | 'cmc_dex'
    | 'coingecko'
    | 'liquidity_unavailable';
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

export type StrategyVerdict =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'CAUTION'
  | 'INSUFFICIENT_DATA';

export type StrategySnapshot = {
  verdict: StrategyVerdict;
  confidence: number;
  reason: string;
  buyZone: string | null;
  sellZone: string | null;
  hardBlocks: string[];
  evidence: string[];
  asOf: string;
  tradingStrategy?: TradingStrategy;
};

export type TradingStrategy = {
  // Entry
  entryPrice: number | null;
  entryZone: string | null; // e.g., "at BOLL lower band", "on pullback to MA25"

  // Support & Resistance
  supportLevels: PriceLevel[];
  resistanceLevels: PriceLevel[];

  // Stop Loss (ATR-based primary, with reference levels)
  stopLoss: StopLossReference | null;

  // Take Profit (multi-level)
  takeProfitLevels: TakeProfitLevel[];

  // Risk/Reward (based on TP1)
  riskRewardRatio: number | null;
  riskLevel: 'low' | 'medium' | 'high';

  // Note: spot vs contract context
  note: string; // e.g., "Spot: 参考减仓/清仓价位" or "Contract: 建议设置止损单"
};

export type PriceLevel = {
  price: number;
  source:
    | 'boll_lower'
    | 'boll_upper'
    | 'boll_middle'
    | 'ma7'
    | 'ma25'
    | 'ma99'
    | 'ath'
    | 'atl'
    | 'fib_0236'
    | 'fib_0382'
    | 'fib_0500'
    | 'fib_0618'
    | 'fib_0786'
    | 'swing_high'
    | 'swing_low'
    | 'psychological';
  label: string; // e.g., "BOLL Lower ($45,200)"
  strength: 'weak' | 'medium' | 'strong';
};

export type TakeProfitLevel = {
  price: number;
  pctFromEntry: number; // percentage from entry price (positive for TP above entry, negative for below)
  label: string; // e.g., "TP1 - R1 ($52,000)"
  strength: 'weak' | 'medium' | 'strong';
};

export type StopLossReference = {
  price: number;
  pctFromEntry: number; // always negative (below entry)
  source:
    | 'atr'
    | 'boll_lower'
    | 'ma25'
    | 'fib_0786'
    | 'swing_low'
    | 'fixed_pct';
  label: string;
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

export type AnalyzeSubmitResponse = {
  status: 'accepted' | 'failed';
  requestId: string;
  threadId: string | null;
  mode: 'created' | 'continued';
  nextAction:
    | 'run_pipeline'
    | 'selection_recorded'
    | 'clarify_input'
    | 'request_not_found';
  message: string;
  errorCode?:
    | 'REQUEST_NOT_FOUND'
    | 'INVALID_SELECTION'
    | 'TARGET_KEY_REQUIRED'
    | 'AMBIGUOUS_USER_REPLY';
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
  state: 'skeleton_ready' | 'ready';
};

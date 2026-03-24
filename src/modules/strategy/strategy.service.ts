import { Injectable } from '@nestjs/common';
import {
  AlertsSnapshot,
  CexNetflowSnapshot,
  LiquiditySnapshot,
  PriceLevel,
  PriceSnapshot,
  SecuritySnapshot,
  StopLossReference,
  StrategySnapshot,
  StrategyVerdict,
  TakeProfitLevel,
  TechnicalSnapshot,
  TokenomicsSnapshot,
  TradingStrategy,
} from '../../data/contracts/analyze-contracts';

type NormalizedDecisionInput = {
  verdict: StrategyVerdict;
  confidence: number;
  reason: string;
  buyZone: string | null;
  sellZone: string | null;
  evidence: string[];
};

type RiskGateInput = {
  price: PriceSnapshot;
  technical: TechnicalSnapshot;
  onchain: CexNetflowSnapshot;
  security: SecuritySnapshot;
  liquidity: LiquiditySnapshot;
  tokenomics: TokenomicsSnapshot;
  sentiment?: {
    signal: 'bullish' | 'bearish' | 'neutral' | null;
    score: number | null;
  };
  alerts: AlertsSnapshot;
};

export type RiskGateResult = {
  type: 'hard_block' | 'data_degraded';
  snapshot: StrategySnapshot;
};

@Injectable()
export class StrategyService {
  readonly moduleName = 'strategy';

  getStatus() {
    return { module: this.moduleName, state: 'ready' as const };
  }

  checkRiskGate(input: RiskGateInput): RiskGateResult | null {
    const hardBlocks = this.checkHardBlocks(input);
    if (hardBlocks.length > 0 || input.alerts.redCount > 0) {
      return {
        type: 'hard_block',
        snapshot: this.buildSnapshot({
          verdict: 'SELL',
          confidence: 0.88,
          reason: `Critical risk controls triggered: ${hardBlocks.join(', ') || 'critical alerts present'}.`,
          buyZone: null,
          sellZone: 'exit-on-strength',
          hardBlocks,
          alerts: input.alerts,
        }),
      };
    }

    if (this.checkMissingCoreData(input)) {
      return {
        type: 'data_degraded',
        snapshot: this.buildSnapshot({
          verdict: 'INSUFFICIENT_DATA',
          confidence: 0.35,
          reason: 'Core evidence is incomplete for a directional decision.',
          buyZone: null,
          sellZone: null,
          hardBlocks: [],
          alerts: input.alerts,
        }),
      };
    }

    return null;
  }

  normalizeDecision(input: {
    price: PriceSnapshot;
    technical: TechnicalSnapshot;
    liquidity: LiquiditySnapshot;
    alerts: AlertsSnapshot;
    hardBlocks: string[];
    decision: NormalizedDecisionInput;
  }): StrategySnapshot {
    const tradingStrategy = this.calculateTradingStrategy({
      price: input.price,
      technical: input.technical,
      liquidity: input.liquidity,
      strategy: {
        verdict: input.decision.verdict,
        confidence: input.decision.confidence,
        reason: input.decision.reason,
        buyZone: input.decision.buyZone,
        sellZone: input.decision.sellZone,
        hardBlocks: input.hardBlocks,
        evidence: input.decision.evidence,
        asOf: new Date().toISOString(),
      },
    });

    return this.buildSnapshot({
      verdict: input.decision.verdict,
      confidence: input.decision.confidence,
      reason: input.decision.reason,
      buyZone: input.decision.buyZone,
      sellZone: input.decision.sellZone,
      hardBlocks: input.hardBlocks,
      alerts: input.alerts,
      evidence: input.decision.evidence,
      tradingStrategy,
    });
  }

  private checkHardBlocks(input: {
    security: SecuritySnapshot;
    liquidity: LiquiditySnapshot;
  }): string[] {
    const blocks: string[] = [];

    if (input.security.isHoneypot === true) {
      blocks.push('SECURITY_HONEYPOT');
    }
    if (
      input.security.riskLevel === 'high' ||
      input.security.riskLevel === 'critical'
    ) {
      blocks.push(`SECURITY_${input.security.riskLevel.toUpperCase()}`);
    }
    if (input.security.canTradeSafely === false) {
      blocks.push('SECURITY_NOT_TRADABLE');
    }
    if (input.liquidity.rugpullRiskSignal === 'critical') {
      blocks.push('LIQUIDITY_CRITICAL_RISK');
    }

    return blocks;
  }

  private checkMissingCoreData(input: {
    price: PriceSnapshot;
    technical: TechnicalSnapshot;
    onchain: CexNetflowSnapshot;
    security: SecuritySnapshot;
    liquidity: LiquiditySnapshot;
    tokenomics: TokenomicsSnapshot;
  }): boolean {
    const onchainUnavailable =
      input.onchain.degraded &&
      !this.isAcceptableDelayedOnchainFallback(input.onchain);

    return (
      input.price.priceUsd === null ||
      input.technical.degraded ||
      onchainUnavailable ||
      input.security.degraded ||
      input.liquidity.degraded ||
      input.tokenomics.tokenomicsEvidenceInsufficient
    );
  }

  private isAcceptableDelayedOnchainFallback(
    onchain: CexNetflowSnapshot,
  ): boolean {
    return (
      onchain.degradeReason === 'CEX_NETFLOW_DELAYED_30D_FALLBACK' &&
      typeof onchain.netflowUsd === 'number' &&
      onchain.signal !== 'neutral'
    );
  }

  /**
   * Calculate trading strategy with Fibonacci, swing levels, ATR stop loss, multi-level TP
   */
  calculateTradingStrategy(input: {
    price: PriceSnapshot;
    technical: TechnicalSnapshot;
    liquidity: LiquiditySnapshot;
    strategy: StrategySnapshot;
  }): TradingStrategy | undefined {
    const { price, technical, liquidity, strategy } = input;

    if (price.priceUsd === null || technical.degraded) {
      return undefined;
    }

    const currentPrice = price.priceUsd;
    const supportLevels = this.buildSupportLevels(price, technical);
    const resistanceLevels = this.buildResistanceLevels(price, technical);

    // For HOLD/CAUTION — return support/resistance only, no entry/exit
    if (strategy.verdict !== 'BUY' && strategy.verdict !== 'SELL') {
      return {
        entryPrice: null,
        entryZone: null,
        supportLevels: supportLevels.slice(0, 5),
        resistanceLevels: resistanceLevels.slice(0, 5),
        stopLoss: null,
        takeProfitLevels: [],
        riskRewardRatio: null,
        riskLevel: this.assessRiskLevel(liquidity),
        note: '当前为观望信号，仅提供支撑/阻力位参考，不建议开仓',
      };
    }

    const entryPrice = currentPrice;
    let entryZone = 'current price';
    let stopLoss: StopLossReference | null = null;
    const takeProfitLevels: TakeProfitLevel[] = [];

    if (strategy.verdict === 'BUY') {
      // Entry zone hint
      const nearMA25 = technical.ma.ma25 !== null && Math.abs(currentPrice - technical.ma.ma25) / currentPrice < 0.02;
      const nearBollLower = technical.boll.lower !== null && Math.abs(currentPrice - technical.boll.lower) / currentPrice < 0.02;
      if (nearBollLower) entryZone = '当前价接近 BOLL 下轨，可考虑入场';
      else if (nearMA25) entryZone = '当前价接近 MA25，可考虑入场';

      // Stop loss: ATR-based first, then closest support
      stopLoss = this.buildStopLoss(entryPrice, technical, supportLevels, 'buy');

      // Take profit: use resistance levels as TP targets
      const resistancesAbove = resistanceLevels.filter(r => r.price > currentPrice);
      for (let i = 0; i < Math.min(3, resistancesAbove.length); i++) {
        const r = resistancesAbove[i];
        const pct = ((r.price - entryPrice) / entryPrice) * 100;
        takeProfitLevels.push({
          price: r.price,
          pctFromEntry: Number(pct.toFixed(2)),
          label: `TP${i + 1} - ${r.label}`,
          strength: r.strength,
        });
      }

      // If not enough resistance targets, add percentage-based
      if (takeProfitLevels.length === 0) {
        takeProfitLevels.push({
          price: Number((entryPrice * 1.05).toFixed(6)),
          pctFromEntry: 5,
          label: 'TP1 - +5%',
          strength: 'weak',
        });
      }
    } else if (strategy.verdict === 'SELL') {
      entryZone = '当前价位，建议减仓/离场';

      // Stop loss above resistance
      stopLoss = this.buildStopLoss(entryPrice, technical, resistanceLevels, 'sell');

      // Take profit: use support levels as TP targets (below current)
      const supportsBelow = supportLevels.filter(s => s.price < currentPrice);
      for (let i = 0; i < Math.min(3, supportsBelow.length); i++) {
        const s = supportsBelow[i];
        const pct = ((s.price - entryPrice) / entryPrice) * 100;
        takeProfitLevels.push({
          price: s.price,
          pctFromEntry: Number(pct.toFixed(2)),
          label: `TP${i + 1} - ${s.label}`,
          strength: s.strength,
        });
      }

      if (takeProfitLevels.length === 0) {
        takeProfitLevels.push({
          price: Number((entryPrice * 0.95).toFixed(6)),
          pctFromEntry: -5,
          label: 'TP1 - -5%',
          strength: 'weak',
        });
      }
    }

    // Risk/Reward based on TP1
    let riskRewardRatio: number | null = null;
    if (stopLoss && takeProfitLevels.length > 0) {
      const slPct = Math.abs(stopLoss.pctFromEntry);
      const tpPct = Math.abs(takeProfitLevels[0].pctFromEntry);
      riskRewardRatio = slPct > 0 ? Number((tpPct / slPct).toFixed(2)) : null;
    }

    const riskLevel = this.assessRiskLevel(liquidity);

    const note = strategy.verdict === 'BUY'
      ? '现货：止盈止损为建议参考价位，可分批操作；合约：建议严格设置止损单'
      : '现货：建议分批减仓至止盈目标位；合约：建议设置止损保护';

    return {
      entryPrice,
      entryZone,
      supportLevels: supportLevels.slice(0, 5),
      resistanceLevels: resistanceLevels.slice(0, 5),
      stopLoss,
      takeProfitLevels,
      riskRewardRatio,
      riskLevel,
      note,
    };
  }

  private buildSupportLevels(price: PriceSnapshot, technical: TechnicalSnapshot): PriceLevel[] {
    const levels: PriceLevel[] = [];

    // BOLL bands
    if (technical.boll.lower !== null) {
      levels.push({ price: technical.boll.lower, source: 'boll_lower', label: `BOLL Lower ($${this.fmtPrice(technical.boll.lower)})`, strength: 'strong' });
    }
    if (technical.boll.middle !== null) {
      levels.push({ price: technical.boll.middle, source: 'boll_middle', label: `BOLL Middle ($${this.fmtPrice(technical.boll.middle)})`, strength: 'medium' });
    }

    // Moving Averages
    if (technical.ma.ma25 !== null) {
      levels.push({ price: technical.ma.ma25, source: 'ma25', label: `MA25 ($${this.fmtPrice(technical.ma.ma25)})`, strength: 'medium' });
    }
    if (technical.ma.ma99 !== null) {
      levels.push({ price: technical.ma.ma99, source: 'ma99', label: `MA99 ($${this.fmtPrice(technical.ma.ma99)})`, strength: 'strong' });
    }

    // Swing Low
    if (technical.swingLow !== null) {
      levels.push({ price: technical.swingLow, source: 'swing_low', label: `Swing Low ($${this.fmtPrice(technical.swingLow)})`, strength: 'strong' });
    }

    // ATL
    if (price.atlUsd !== null) {
      levels.push({ price: price.atlUsd, source: 'atl', label: `All-Time Low ($${this.fmtPrice(price.atlUsd)})`, strength: 'strong' });
    }

    // Fibonacci levels (between swing low and swing high / ATH)
    const fibLevels = this.calculateFibonacciLevels(price, technical);
    for (const fib of fibLevels) {
      if (price.priceUsd !== null && fib.price < price.priceUsd) {
        levels.push(fib);
      }
    }

    // Psychological levels
    if (price.priceUsd !== null) {
      const psych = this.findPsychologicalLevel(price.priceUsd, 'below');
      if (psych !== null) {
        levels.push({ price: psych, source: 'psychological', label: `心理关口 ($${this.fmtPrice(psych)})`, strength: 'medium' });
      }
    }

    // Sort by price descending (closest to current first)
    levels.sort((a, b) => b.price - a.price);
    // Deduplicate levels very close to each other (within 0.5%)
    return this.deduplicateLevels(levels);
  }

  private buildResistanceLevels(price: PriceSnapshot, technical: TechnicalSnapshot): PriceLevel[] {
    const levels: PriceLevel[] = [];

    // BOLL upper
    if (technical.boll.upper !== null) {
      levels.push({ price: technical.boll.upper, source: 'boll_upper', label: `BOLL Upper ($${this.fmtPrice(technical.boll.upper)})`, strength: 'strong' });
    }

    // Swing High
    if (technical.swingHigh !== null) {
      levels.push({ price: technical.swingHigh, source: 'swing_high', label: `Swing High ($${this.fmtPrice(technical.swingHigh)})`, strength: 'strong' });
    }

    // ATH
    if (price.athUsd !== null) {
      levels.push({ price: price.athUsd, source: 'ath', label: `All-Time High ($${this.fmtPrice(price.athUsd)})`, strength: 'strong' });
    }

    // Fibonacci levels above current price
    const fibLevels = this.calculateFibonacciLevels(price, technical);
    for (const fib of fibLevels) {
      if (price.priceUsd !== null && fib.price > price.priceUsd) {
        levels.push(fib);
      }
    }

    // Psychological levels
    if (price.priceUsd !== null) {
      const psych = this.findPsychologicalLevel(price.priceUsd, 'above');
      if (psych !== null) {
        levels.push({ price: psych, source: 'psychological', label: `心理关口 ($${this.fmtPrice(psych)})`, strength: 'medium' });
      }
    }

    // Sort by price ascending (closest resistance first)
    levels.sort((a, b) => a.price - b.price);
    return this.deduplicateLevels(levels);
  }

  private calculateFibonacciLevels(price: PriceSnapshot, technical: TechnicalSnapshot): PriceLevel[] {
    // Use swing high/low or ATH/ATL as Fibonacci anchors
    const high = technical.swingHigh ?? price.athUsd;
    const low = technical.swingLow ?? price.atlUsd;
    if (high === null || low === null || high <= low) {
      return [];
    }

    const range = high - low;
    const fibRatios: Array<{ ratio: number; source: PriceLevel['source']; strength: PriceLevel['strength'] }> = [
      { ratio: 0.236, source: 'fib_0236', strength: 'weak' },
      { ratio: 0.382, source: 'fib_0382', strength: 'medium' },
      { ratio: 0.500, source: 'fib_0500', strength: 'strong' },
      { ratio: 0.618, source: 'fib_0618', strength: 'strong' },
      { ratio: 0.786, source: 'fib_0786', strength: 'medium' },
    ];

    return fibRatios.map(({ ratio, source, strength }) => {
      // Fibonacci retracement: measured from high down
      const fibPrice = high - range * ratio;
      return {
        price: Number(fibPrice.toFixed(6)),
        source,
        label: `Fib ${(ratio * 100).toFixed(1)}% ($${this.fmtPrice(fibPrice)})`,
        strength,
      };
    });
  }

  private findPsychologicalLevel(currentPrice: number, direction: 'above' | 'below'): number | null {
    // Find the nearest round number (psychological level)
    if (currentPrice <= 0) return null;

    let magnitude: number;
    if (currentPrice >= 10000) magnitude = 1000;
    else if (currentPrice >= 1000) magnitude = 100;
    else if (currentPrice >= 100) magnitude = 10;
    else if (currentPrice >= 10) magnitude = 1;
    else if (currentPrice >= 1) magnitude = 0.1;
    else if (currentPrice >= 0.01) magnitude = 0.001;
    else return null; // too small for meaningful psychological levels

    if (direction === 'below') {
      const level = Math.floor(currentPrice / magnitude) * magnitude;
      // Only return if reasonably close (within 10%)
      return (currentPrice - level) / currentPrice < 0.1 ? level : null;
    } else {
      const level = Math.ceil(currentPrice / magnitude) * magnitude;
      return (level - currentPrice) / currentPrice < 0.1 ? level : null;
    }
  }

  private buildStopLoss(
    entryPrice: number,
    technical: TechnicalSnapshot,
    levels: PriceLevel[],
    side: 'buy' | 'sell',
  ): StopLossReference {
    const atr = technical.atr.value;

    // Primary: ATR-based (1.5x ATR from entry)
    if (atr !== null && atr > 0) {
      const slPrice = side === 'buy'
        ? entryPrice - 1.5 * atr
        : entryPrice + 1.5 * atr;
      const pct = ((slPrice - entryPrice) / entryPrice) * 100;
      return {
        price: Number(slPrice.toFixed(6)),
        pctFromEntry: Number(pct.toFixed(2)),
        source: 'atr',
        label: `ATR Stop (1.5x ATR = $${this.fmtPrice(slPrice)})`,
      };
    }

    // Fallback: closest level
    if (side === 'buy') {
      const support = levels.find(l => l.price < entryPrice);
      if (support) {
        const pct = ((support.price - entryPrice) / entryPrice) * 100;
        const source = this.toStopLossSource(support.source);
        return {
          price: support.price,
          pctFromEntry: Number(pct.toFixed(2)),
          source,
          label: `Stop at ${support.label}`,
        };
      }
    } else {
      const resistance = levels.find(l => l.price > entryPrice);
      if (resistance) {
        const pct = ((resistance.price - entryPrice) / entryPrice) * 100;
        const source = this.toStopLossSource(resistance.source);
        return {
          price: resistance.price,
          pctFromEntry: Number(pct.toFixed(2)),
          source,
          label: `Stop at ${resistance.label}`,
        };
      }
    }

    // Last resort: fixed 3%
    const fallbackPrice = side === 'buy' ? entryPrice * 0.97 : entryPrice * 1.03;
    return {
      price: Number(fallbackPrice.toFixed(6)),
      pctFromEntry: side === 'buy' ? -3 : 3,
      source: 'fixed_pct',
      label: `固定 3% Stop ($${this.fmtPrice(fallbackPrice)})`,
    };
  }

  private toStopLossSource(source: PriceLevel['source']): StopLossReference['source'] {
    if (source === 'boll_lower') return 'boll_lower';
    if (source === 'ma25') return 'ma25';
    if (source === 'fib_0786') return 'fib_0786';
    if (source === 'swing_low') return 'swing_low';
    return 'fixed_pct';
  }

  private assessRiskLevel(liquidity: LiquiditySnapshot): 'low' | 'medium' | 'high' {
    if (liquidity.rugpullRiskSignal === 'high' || liquidity.rugpullRiskSignal === 'critical') {
      return 'high';
    }
    if (liquidity.rugpullRiskSignal === 'low') {
      return 'low';
    }
    return 'medium';
  }

  private deduplicateLevels(levels: PriceLevel[]): PriceLevel[] {
    const result: PriceLevel[] = [];
    for (const level of levels) {
      const tooClose = result.some(
        existing => Math.abs(existing.price - level.price) / Math.max(existing.price, 0.0001) < 0.005,
      );
      if (!tooClose) {
        result.push(level);
      }
    }
    return result;
  }

  private fmtPrice(value: number): string {
    if (value >= 1000) return value.toFixed(2);
    if (value >= 1) return value.toFixed(4);
    return value.toFixed(8);
  }

  private buildSnapshot(input: {
    verdict: StrategyVerdict;
    confidence: number;
    reason: string;
    buyZone: string | null;
    sellZone: string | null;
    hardBlocks: string[];
    alerts: AlertsSnapshot;
    evidence?: string[];
    tradingStrategy?: TradingStrategy;
  }): StrategySnapshot {
    const allEvidence = [
      ...(input.evidence ?? []),
      ...input.alerts.items
        .filter((item) => item.severity === 'critical')
        .map((item) => `${item.code}: ${item.message}`),
    ];

    return {
      verdict: input.verdict,
      confidence: input.confidence,
      reason: input.reason,
      buyZone: input.buyZone,
      sellZone: input.sellZone,
      hardBlocks: input.hardBlocks,
      evidence: allEvidence.length > 0 ? allEvidence : ['No critical evidence'],
      asOf: new Date().toISOString(),
      tradingStrategy: input.tradingStrategy,
    };
  }

}

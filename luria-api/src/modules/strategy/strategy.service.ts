import { Injectable } from '@nestjs/common';
import {
  AlertsSnapshot,
  CexNetflowSnapshot,
  LiquiditySnapshot,
  PriceSnapshot,
  SecuritySnapshot,
  StrategySnapshot,
  TechnicalSnapshot,
  TokenomicsSnapshot,
} from '../../core/contracts/analyze-contracts';

@Injectable()
export class StrategyService {
  readonly moduleName = 'strategy';

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  evaluate(input: {
    price: PriceSnapshot;
    technical: TechnicalSnapshot;
    onchain: CexNetflowSnapshot;
    security: SecuritySnapshot;
    liquidity: LiquiditySnapshot;
    tokenomics: TokenomicsSnapshot;
    alerts: AlertsSnapshot;
  }): StrategySnapshot {
    const hardBlocks: string[] = [];
    const evidence: string[] = [];

    if (input.security.isHoneypot === true) {
      hardBlocks.push('SECURITY_HONEYPOT');
    }
    if (input.security.riskLevel === 'high' || input.security.riskLevel === 'critical') {
      hardBlocks.push(`SECURITY_${input.security.riskLevel.toUpperCase()}`);
    }
    if (input.security.canTradeSafely === false) {
      hardBlocks.push('SECURITY_NOT_TRADABLE');
    }
    if (input.liquidity.rugpullRiskSignal === 'critical') {
      hardBlocks.push('LIQUIDITY_CRITICAL_RISK');
    }

    if (hardBlocks.length > 0 || input.alerts.redCount > 0) {
      return {
        verdict: 'SELL',
        confidence: 0.88,
        reason: 'Critical risk controls triggered.',
        buyZone: null,
        sellZone: 'exit-on-strength',
        hardBlocks,
        evidence: [
          ...evidence,
          ...input.alerts.items
            .filter((item) => item.severity === 'critical')
            .map((item) => `${item.code}: ${item.message}`),
        ],
        asOf: new Date().toISOString(),
      };
    }

    const missingCoreData =
      input.price.priceUsd === null ||
      input.technical.degraded ||
      input.onchain.degraded ||
      input.security.degraded ||
      input.liquidity.degraded ||
      input.tokenomics.tokenomicsEvidenceInsufficient;

    if (missingCoreData) {
      return {
        verdict: 'INSUFFICIENT_DATA',
        confidence: 0.35,
        reason: 'Core evidence is incomplete for a directional decision.',
        buyZone: null,
        sellZone: null,
        hardBlocks: [],
        evidence: ['Core module degradation or tokenomics evidence missing.'],
        asOf: new Date().toISOString(),
      };
    }

    let bullScore = 0;
    let bearScore = 0;

    if (input.technical.summarySignal === 'bullish') {
      bullScore += 1;
      evidence.push('Technical summary is bullish.');
    } else if (input.technical.summarySignal === 'bearish') {
      bearScore += 1;
      evidence.push('Technical summary is bearish.');
    }

    if (input.onchain.signal === 'buy_pressure') {
      bullScore += 1;
      evidence.push('CEX netflow indicates buy pressure.');
    } else if (input.onchain.signal === 'sell_pressure') {
      bearScore += 1;
      evidence.push('CEX netflow indicates sell pressure.');
    }

    if (typeof input.price.change24hPct === 'number') {
      if (input.price.change24hPct > 2) {
        bullScore += 1;
        evidence.push('Price trend is positive in 24h.');
      } else if (input.price.change24hPct < -2) {
        bearScore += 1;
        evidence.push('Price trend is negative in 24h.');
      }
    }

    if (input.alerts.yellowCount > 1) {
      bearScore += 1;
      evidence.push('Multiple warning alerts are active.');
    }

    const delta = bullScore - bearScore;

    if (input.alerts.alertLevel === 'yellow') {
      if (delta <= -2) {
        return {
          verdict: 'SELL',
          confidence: 0.68,
          reason: 'Warning alerts are active and downside signals dominate.',
          buyZone: null,
          sellZone: 'reduce-on-bounce',
          hardBlocks: [],
          evidence,
          asOf: new Date().toISOString(),
        };
      }

      return {
        verdict: 'CAUTION',
        confidence: 0.62,
        reason: 'Warning alerts are active; avoid aggressive long entry.',
        buyZone: null,
        sellZone: null,
        hardBlocks: [],
        evidence,
        asOf: new Date().toISOString(),
      };
    }

    if (delta >= 2) {
      return {
        verdict: 'BUY',
        confidence: 0.72,
        reason: 'Signals are aligned to upside with no critical risk block.',
        buyZone: 'dca-near-ma25',
        sellZone: 'take-profit-near-boll-upper',
        hardBlocks: [],
        evidence,
        asOf: new Date().toISOString(),
      };
    }

    if (delta <= -2) {
      return {
        verdict: 'SELL',
        confidence: 0.72,
        reason: 'Signals are aligned to downside.',
        buyZone: null,
        sellZone: 'reduce-on-bounce',
        hardBlocks: [],
        evidence,
        asOf: new Date().toISOString(),
      };
    }

    return {
      verdict: 'HOLD',
      confidence: 0.58,
      reason: 'Signals are mixed; wait for clearer confirmation.',
      buyZone: null,
      sellZone: null,
      hardBlocks: [],
      evidence,
      asOf: new Date().toISOString(),
    };
  }
}

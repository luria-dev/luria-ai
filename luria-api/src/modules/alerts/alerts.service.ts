import { Injectable } from '@nestjs/common';
import {
  AlertsSnapshot,
  CexNetflowSnapshot,
  LiquiditySnapshot,
  PriceSnapshot,
  SecuritySnapshot,
  TokenomicsSnapshot,
} from '../../core/contracts/analyze-contracts';

@Injectable()
export class AlertsService {
  readonly moduleName = 'alerts';

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  buildSnapshot(input: {
    price: PriceSnapshot;
    onchain: CexNetflowSnapshot;
    security: SecuritySnapshot;
    liquidity: LiquiditySnapshot;
    tokenomics: TokenomicsSnapshot;
  }): AlertsSnapshot {
    const items: AlertsSnapshot['items'] = [];
    const alertType = new Set<AlertsSnapshot['alertType'][number]>();

    if (input.security.isHoneypot === true) {
      items.push({
        code: 'SECURITY_HONEYPOT',
        severity: 'critical',
        message: 'Honeypot risk detected.',
      });
      alertType.add('security_redline');
    }

    if (input.security.riskLevel === 'high' || input.security.riskLevel === 'critical') {
      items.push({
        code: 'SECURITY_HIGH_RISK',
        severity: 'critical',
        message: `Security risk level is ${input.security.riskLevel}.`,
      });
      alertType.add('security_redline');
    }

    if (input.liquidity.rugpullRiskSignal === 'high' || input.liquidity.rugpullRiskSignal === 'critical') {
      items.push({
        code: 'LIQUIDITY_HIGH_RISK',
        severity: input.liquidity.rugpullRiskSignal === 'critical' ? 'critical' : 'warning',
        message: `Liquidity rugpull risk is ${input.liquidity.rugpullRiskSignal}.`,
      });
      alertType.add('liquidity_withdrawal_risk');
    }

    if (input.liquidity.withdrawalRiskFlag) {
      items.push({
        code: 'LIQUIDITY_HIGH_RISK',
        severity: 'critical',
        message: 'Rapid liquidity withdrawal signal triggered.',
      });
      alertType.add('liquidity_withdrawal_risk');
    }

    if (typeof input.price.change24hPct === 'number' && Math.abs(input.price.change24hPct) >= 15) {
      items.push({
        code: 'PRICE_ABNORMAL_VOLATILITY',
        severity: 'warning',
        message: `24h price change is ${input.price.change24hPct.toFixed(2)}%.`,
      });
      alertType.add('price_abnormal_volatility');
    }

    if (input.onchain.signal === 'sell_pressure') {
      items.push({
        code: 'CEX_SELL_PRESSURE',
        severity: 'warning',
        message: 'Exchange netflow indicates sell pressure.',
      });
      alertType.add('cex_inflow_spike');
    }

    if (input.tokenomics.tokenomicsEvidenceInsufficient) {
      items.push({
        code: 'TOKENOMICS_EVIDENCE_MISSING',
        severity: 'warning',
        message: 'Tokenomics evidence is insufficient.',
      });
      alertType.add('tokenomics_evidence_missing');
    }

    if (
      input.price.degraded ||
      input.onchain.degraded ||
      input.security.degraded ||
      input.liquidity.degraded ||
      input.tokenomics.degraded
    ) {
      items.push({
        code: 'DATA_DEGRADED',
        severity: 'warning',
        message: 'One or more upstream data sources are degraded.',
      });
      alertType.add('data_degraded');
    }

    const redCount = items.filter((item) => item.severity === 'critical').length;
    const yellowCount = items.filter((item) => item.severity === 'warning').length;
    const alertLevel: AlertsSnapshot['alertLevel'] =
      redCount > 0 ? 'red' : yellowCount > 0 ? 'yellow' : 'info';
    const riskState: AlertsSnapshot['riskState'] =
      alertLevel === 'red' ? 'emergency' : alertLevel === 'yellow' ? 'elevated' : 'normal';

    return {
      alertLevel,
      alertType: [...alertType],
      riskState,
      redCount,
      yellowCount,
      items,
      asOf: new Date().toISOString(),
    };
  }
}

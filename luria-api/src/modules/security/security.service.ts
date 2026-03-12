import { Injectable, Logger } from '@nestjs/common';
import { AnalyzeIdentity, SecurityRiskItem, SecuritySnapshot } from '../../core/contracts/analyze-contracts';

type GoPlusResponse = {
  result?: Record<string, Record<string, unknown>>;
};

@Injectable()
export class SecurityService {
  readonly moduleName = 'security';
  private readonly logger = new Logger(SecurityService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<SecuritySnapshot> {
    const raw = await this.fetchGoPlusRaw(identity);
    return this.toSnapshot(raw, identity);
  }

  private async fetchGoPlusRaw(identity: AnalyzeIdentity): Promise<Record<string, unknown>> {
    const chainId = this.toGoPlusChainId(identity.chain);
    if (!chainId) {
      // TODO(security-multi-chain):
      // Add non-EVM security adapters and route by chain.
      // Suggested providers to evaluate per chain:
      // - Solana: Rugcheck / SolSniffer / Blockaid
      // - TON/TRON/Sui/Aptos: pick dedicated source and map to SecuritySnapshot
      // Current behavior is intentionally fail-fast (no degrade fallback) for unsupported chains.
      throw new Error(`SECURITY_CHAIN_UNSUPPORTED:${identity.chain}`);
    }

    const baseUrl = process.env.GOPLUS_API_BASE_URL ?? 'https://api.gopluslabs.io/api/v1/token_security';
    const timeoutMs = Number(process.env.GOPLUS_TIMEOUT_MS ?? 5000);
    const url = `${baseUrl}/${chainId}?contract_addresses=${encodeURIComponent(identity.tokenAddress)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const token = process.env.GOPLUS_ACCESS_TOKEN;
      if (token?.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        throw new Error(`SECURITY_SOURCE_HTTP_${response.status}`);
      }

      const body = (await response.json()) as GoPlusResponse;
      const key = identity.tokenAddress.toLowerCase();
      const result = body.result?.[key] ?? body.result?.[identity.tokenAddress];
      if (!result) {
        throw new Error('SECURITY_RESULT_NOT_FOUND');
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`GoPlus security fetch failed for ${identity.symbol}: ${message}`);
      throw new Error(`SECURITY_FETCH_FAILED:${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toSnapshot(raw: Record<string, unknown>, identity: AnalyzeIdentity): SecuritySnapshot {
    const isHoneypot = this.toBool(raw.is_honeypot);
    const cannotSellAll = this.toBool(raw.cannot_sell_all) ?? this.toBool(raw.cannot_sell);
    const isBlacklisted =
      this.toBool(raw.is_blacklisted) ??
      this.toBool(raw.blacklist) ??
      this.toBool(raw.is_in_dex);
    const ownerAddress = this.toString(raw.owner_address);
    const ownerRenounced = this.detectOwnerRenounced(ownerAddress);
    const ownerCanMint = this.toBool(raw.is_mintable);
    const canTakeBackOwnership = this.toBool(raw.can_take_back_ownership);
    const isOpenSource = this.toBool(raw.is_open_source);
    const isProxy = this.toBool(raw.is_proxy);
    const isTradingCooldown = this.toBool(raw.trading_cooldown);
    const cannotBuy = this.toBool(raw.cannot_buy);
    const buyTax = this.toNumber(raw.buy_tax);
    const sellTax = this.toNumber(raw.sell_tax);

    const riskItems: SecurityRiskItem[] = [];
    let score = 0;

    if (isHoneypot === true) {
      riskItems.push({
        code: 'HONEYPOT',
        severity: 'critical',
        message: 'Honeypot pattern detected; sell transaction may fail.',
      });
      score += 95;
    }
    if (cannotSellAll === true) {
      riskItems.push({
        code: 'TRADING_COOLDOWN',
        severity: 'critical',
        message: 'Token shows sell restriction signals.',
      });
      score += 90;
    }
    if (isBlacklisted === true) {
      riskItems.push({
        code: 'BLACKLIST_FUNCTION',
        severity: 'high',
        message: 'Blacklist-like behavior is detected.',
      });
      score += 70;
    }
    if (ownerRenounced === false || canTakeBackOwnership === true) {
      riskItems.push({
        code: 'OWNER_NOT_RENOUNCED',
        severity: 'medium',
        message: 'Owner permission is active or recoverable.',
      });
      score += 20;
    }
    if (ownerCanMint === true) {
      riskItems.push({
        code: 'MINT_FUNCTION',
        severity: 'high',
        message: 'Mint capability is active.',
      });
      score += 35;
    }
    if (isTradingCooldown === true || cannotBuy === true) {
      riskItems.push({
        code: 'TRADING_COOLDOWN',
        severity: 'high',
        message: 'Trading control restrictions detected.',
      });
      score += 35;
    }
    if ((typeof buyTax === 'number' && buyTax >= 20) || (typeof sellTax === 'number' && sellTax >= 20)) {
      riskItems.push({
        code: 'UNKNOWN',
        severity: sellTax !== null && sellTax >= 40 ? 'critical' : 'high',
        message: `High transfer tax detected (buy=${buyTax ?? 'n/a'}%, sell=${sellTax ?? 'n/a'}%).`,
      });
      score += sellTax !== null && sellTax >= 40 ? 40 : 25;
    }
    if (isOpenSource === false || isProxy === true) {
      riskItems.push({
        code: 'UNKNOWN',
        severity: 'medium',
        message: 'Contract transparency is limited (proxy or not open source).',
      });
      score += 15;
    }

    if (riskItems.length === 0) {
      riskItems.push({
        code: 'UNKNOWN',
        severity: 'low',
        message: 'No major security red flags were detected by current source.',
      });
    }

    score = Math.min(100, score);
    const riskLevel = this.toRiskLevel(score);
    const canTradeSafely =
      isHoneypot !== true &&
      cannotSellAll !== true &&
      isBlacklisted !== true &&
      riskLevel !== 'high' &&
      riskLevel !== 'critical';

    return {
      isContractOpenSource: isOpenSource,
      isHoneypot,
      isOwnerRenounced: ownerRenounced,
      riskScore: score,
      riskLevel,
      riskItems,
      canTradeSafely,
      asOf: new Date().toISOString(),
      sourceUsed: 'goplus',
      degraded: false,
    };
  }

  private toGoPlusChainId(chain: string): string | null {
    const normalized = chain.trim().toLowerCase();
    // TODO(security-multi-chain):
    // This map currently covers GoPlus EVM-style chains only.
    // Extend via adapter registry instead of hard-coding all chains in one map.
    const mapping: Record<string, string> = {
      ethereum: '1',
      eth: '1',
      bsc: '56',
      bnb: '56',
      polygon: '137',
      matic: '137',
      arbitrum: '42161',
      arb: '42161',
      avalanche: '43114',
      avax: '43114',
      base: '8453',
    };
    return mapping[normalized] ?? null;
  }

  private detectOwnerRenounced(ownerAddress: string | null): boolean | null {
    if (ownerAddress === null) {
      return null;
    }
    const normalized = ownerAddress.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return normalized === '0x0000000000000000000000000000000000000000';
  }

  private toBool(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no'].includes(normalized)) {
        return false;
      }
      if (normalized === '') {
        return null;
      }
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace('%', '');
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private toString(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }
    return null;
  }

  private toRiskLevel(score: number): SecuritySnapshot['riskLevel'] {
    if (score >= 85) {
      return 'critical';
    }
    if (score >= 65) {
      return 'high';
    }
    if (score >= 40) {
      return 'medium';
    }
    return 'low';
  }
}

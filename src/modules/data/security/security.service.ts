import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  SecurityRiskItem,
  SecuritySnapshot,
} from '../../../data/contracts/analyze-contracts';

type BlockaidResponse = {
  data?: unknown;
  result?: unknown;
};

@Injectable()
export class SecurityService {
  readonly moduleName = 'security';
  private readonly logger = new Logger(SecurityService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<SecuritySnapshot> {
    const raw = await this.fetchBlockaidRaw(identity);
    return this.toSnapshot(raw);
  }

  private async fetchBlockaidRaw(
    identity: AnalyzeIdentity,
  ): Promise<Record<string, unknown>> {
    const baseUrl =
      process.env.BLOCKAID_SECURITY_URL ??
      'https://api.blockaid.io/v0/token/security';
    const timeoutMs = Number(process.env.BLOCKAID_TIMEOUT_MS ?? 5000);
    const chain = this.normalizeChain(identity.chain);
    const template = process.env.BLOCKAID_SECURITY_URL_TEMPLATE;
    const url = template?.trim()
      ? template
          .replaceAll('{chain}', encodeURIComponent(chain))
          .replaceAll(
            '{tokenAddress}',
            encodeURIComponent(identity.tokenAddress),
          )
      : `${baseUrl}?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(identity.tokenAddress)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      const apiKey = process.env.BLOCKAID_API_KEY;
      if (apiKey?.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
        headers['x-api-key'] = apiKey.trim();
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        throw new Error(`SECURITY_SOURCE_HTTP_${response.status}`);
      }

      const body = (await response.json()) as BlockaidResponse;
      const raw = this.extractResult(body);
      if (!raw) {
        throw new Error('SECURITY_RESULT_NOT_FOUND');
      }
      return raw;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Blockaid security fetch failed for ${identity.symbol}: ${message}`,
      );
      throw new Error(`SECURITY_FETCH_FAILED:${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractResult(
    body: BlockaidResponse,
  ): Record<string, unknown> | null {
    const candidates = [body.data, body.result, body] as unknown[];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        const obj = candidate as Record<string, unknown>;
        if (
          'is_honeypot' in obj ||
          'is_malicious' in obj ||
          'risk_score' in obj ||
          'quote' in obj
        ) {
          return obj;
        }
        if (obj.data && typeof obj.data === 'object') {
          return obj.data as Record<string, unknown>;
        }
      }
    }
    return null;
  }

  private toSnapshot(raw: Record<string, unknown>): SecuritySnapshot {
    const isHoneypot =
      this.toBool(raw.is_honeypot) ??
      this.toBool(raw.honeypot) ??
      this.toBool(
        (raw.scam as Record<string, unknown> | undefined)?.honeypot,
      ) ??
      null;

    const cannotSellAll =
      this.toBool(raw.cannot_sell_all) ??
      this.toBool(raw.cannot_sell) ??
      this.toBool(raw.sell_restricted) ??
      this.toBool(
        (raw.trading as Record<string, unknown> | undefined)?.sell_blocked,
      ) ??
      null;

    const isBlacklisted =
      this.toBool(raw.is_blacklisted) ??
      this.toBool(raw.blacklisted) ??
      this.toBool(raw.blacklist) ??
      null;

    const ownerCanMint =
      this.toBool(raw.is_mintable) ??
      this.toBool(raw.mintable) ??
      this.toBool(
        (raw.permissions as Record<string, unknown> | undefined)?.can_mint,
      ) ??
      null;

    const ownerRenounced =
      this.toBool(raw.owner_renounced) ??
      this.toBool(raw.is_owner_renounced) ??
      this.detectOwnerRenounced(this.toString(raw.owner_address));

    const isOpenSource =
      this.toBool(raw.is_open_source) ??
      this.toBool(raw.open_source) ??
      this.toBool(raw.verified);

    const isProxy = this.toBool(raw.is_proxy) ?? this.toBool(raw.proxy) ?? null;
    const cannotBuy =
      this.toBool(raw.cannot_buy) ?? this.toBool(raw.buy_restricted) ?? null;
    const buyTax = this.toNumber(raw.buy_tax);
    const sellTax = this.toNumber(raw.sell_tax);

    const riskItems: SecurityRiskItem[] = [];
    let score = this.toNumber(raw.risk_score) ?? 0;

    if (
      this.toBool(raw.is_malicious) === true ||
      this.toBool(raw.malicious) === true
    ) {
      riskItems.push({
        code: 'UNKNOWN',
        severity: 'critical',
        message: 'Blockaid marked token as malicious.',
      });
      score = Math.max(score, 95);
    }

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
    if (ownerRenounced === false) {
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
    if (cannotBuy === true) {
      riskItems.push({
        code: 'TRADING_COOLDOWN',
        severity: 'high',
        message: 'Trading control restrictions detected.',
      });
      score += 35;
    }
    if (
      (typeof buyTax === 'number' && buyTax >= 20) ||
      (typeof sellTax === 'number' && sellTax >= 20)
    ) {
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
      riskScore: Number.isFinite(score) ? Number(score.toFixed(2)) : null,
      riskLevel,
      riskItems,
      canTradeSafely,
      asOf: new Date().toISOString(),
      sourceUsed: 'blockaid',
      degraded: false,
    };
  }

  private normalizeChain(chain: string): string {
    const normalized = chain.trim().toLowerCase();
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      eth: 'ethereum',
      bsc: 'bsc',
      bnb: 'bsc',
      polygon: 'polygon',
      matic: 'polygon',
      arbitrum: 'arbitrum',
      arb: 'arbitrum',
      avalanche: 'avalanche',
      avax: 'avalanche',
      base: 'base',
      solana: 'solana',
      sol: 'solana',
      tron: 'tron',
      ton: 'ton',
      sui: 'sui',
      aptos: 'aptos',
    };
    return mapping[normalized] ?? normalized;
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
    if (score >= 0) {
      return 'low';
    }
    return 'unknown';
  }
}

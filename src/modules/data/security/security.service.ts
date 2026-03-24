import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeIdentity,
  SecurityRiskItem,
  SecuritySnapshot,
} from '../../../data/contracts/analyze-contracts';
import { TOKEN_REGISTRY } from '../market/native-tokens';

type GoPlusResponse = {
  result?: unknown;
  data?: unknown;
};

@Injectable()
export class SecurityService {
  readonly moduleName = 'security';
  private readonly logger = new Logger(SecurityService.name);

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }

  async fetchSnapshot(identity: AnalyzeIdentity): Promise<SecuritySnapshot> {
    const meta = TOKEN_REGISTRY[identity.symbol.toUpperCase()];
    const isNativeToken =
      (meta && meta.hasContract === false) || !identity.tokenAddress?.trim();

    if (isNativeToken) {
      return this.buildNativeTokenSnapshot(identity);
    }

    const raw = await this.fetchGoPlusRaw(identity);
    return this.toSnapshot(raw);
  }

  private async fetchGoPlusRaw(
    identity: AnalyzeIdentity,
  ): Promise<Record<string, unknown>> {
    const chainId = this.toGoPlusChainId(identity.chain);
    if (!chainId) {
      throw new Error(`SECURITY_CHAIN_NOT_SUPPORTED:${identity.chain}`);
    }

    const baseUrl =
      process.env.GOPLUS_SECURITY_URL ??
      'https://api.gopluslabs.io/api/v1/token_security';
    const timeoutMs = Number(process.env.GOPLUS_TIMEOUT_MS ?? 5000);
    const appKey = process.env.GOPLUS_APP_KEY ?? process.env.APP_Key;
    const appSecret = process.env.GOPLUS_APP_SECRET ?? process.env.APP_Secret;

    const template = process.env.GOPLUS_SECURITY_URL_TEMPLATE;
    let url = template?.trim()
      ? template
          .replaceAll('{chainId}', encodeURIComponent(chainId))
          .replaceAll('{tokenAddress}', encodeURIComponent(identity.tokenAddress))
      : `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(chainId)}?contract_addresses=${encodeURIComponent(identity.tokenAddress)}`;

    const urlObj = new URL(url);
    if (appKey?.trim() && !urlObj.searchParams.has('app_key')) {
      urlObj.searchParams.set('app_key', appKey.trim());
    }
    if (appSecret?.trim() && !urlObj.searchParams.has('app_secret')) {
      urlObj.searchParams.set('app_secret', appSecret.trim());
    }
    url = urlObj.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (appKey?.trim()) {
        headers['x-api-key'] = appKey.trim();
        headers['app-key'] = appKey.trim();
      }
      if (appSecret?.trim()) {
        headers['app-secret'] = appSecret.trim();
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        throw new Error(`SECURITY_SOURCE_HTTP_${response.status}`);
      }

      const body = (await response.json()) as GoPlusResponse;
      const raw = this.extractResult(body, identity.tokenAddress);
      if (!raw) {
        throw new Error('SECURITY_RESULT_NOT_FOUND');
      }
      return raw;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `GoPlus security fetch failed for ${identity.symbol}: ${message}`,
      );
      throw new Error(`SECURITY_FETCH_FAILED:${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildNativeTokenSnapshot(identity: AnalyzeIdentity): SecuritySnapshot {
    return {
      isContractOpenSource: null,
      isHoneypot: false,
      isOwnerRenounced: null,
      riskScore: 5,
      riskLevel: 'low',
      riskItems: [],
      canTradeSafely: true,
      holderCount: null,
      lpHolderCount: null,
      creatorPercent: null,
      ownerPercent: null,
      isInCex: true,
      cexList: [],
      isInDex: null,
      transferPausable: null,
      selfdestruct: null,
      externalCall: null,
      honeypotWithSameCreator: null,
      trustList: null,
      isAntiWhale: null,
      transferTax: 0,
      asOf: new Date().toISOString(),
      sourceUsed: 'security_unavailable',
      degraded: false,
      degradeReason: `NATIVE_TOKEN:${identity.symbol}`,
    };
  }

  private extractResult(
    body: GoPlusResponse,
    tokenAddress: string,
  ): Record<string, unknown> | null {
    const addressLower = tokenAddress.toLowerCase();
    const candidates = [body.result, body.data, body] as unknown[];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      const obj = candidate as Record<string, unknown>;
      const byAddress =
        obj[addressLower] ??
        obj[tokenAddress] ??
        obj[tokenAddress.toUpperCase()] ??
        obj[tokenAddress.toLowerCase()];
      if (byAddress && typeof byAddress === 'object') {
        return byAddress as Record<string, unknown>;
      }

      if (
        'is_honeypot' in obj ||
        'is_open_source' in obj ||
        'is_blacklisted' in obj ||
        'buy_tax' in obj ||
        'sell_tax' in obj
      ) {
        return obj;
      }

      for (const value of Object.values(obj)) {
        if (
          value &&
          typeof value === 'object' &&
          ('is_honeypot' in (value as Record<string, unknown>) ||
            'is_open_source' in (value as Record<string, unknown>) ||
            'is_blacklisted' in (value as Record<string, unknown>))
        ) {
          return value as Record<string, unknown>;
        }
      }
    }

    return null;
  }

  private toSnapshot(raw: Record<string, unknown>): SecuritySnapshot {
    const isHoneypot =
      this.toBool(raw.is_honeypot) ?? this.toBool(raw.honeypot) ?? null;

    const cannotSellAll =
      this.toBool(raw.cannot_sell_all) ??
      this.toBool(raw.cannot_sell) ??
      this.toBool(raw.sell_restricted) ??
      null;

    const isBlacklisted =
      this.toBool(raw.is_blacklisted) ?? this.toBool(raw.blacklisted) ?? null;

    const ownerCanMint =
      this.toBool(raw.is_mintable) ??
      this.toBool(raw.can_mint) ??
      this.toBool(raw.owner_can_mint) ??
      null;

    const ownerRenounced =
      this.resolveOwnerRenounced({
        ownerAddress: this.toString(raw.owner_address),
        canTakeBackOwnership: this.toBool(raw.can_take_back_ownership),
        hiddenOwner: this.toBool(raw.hidden_owner),
      }) ?? this.toBool(raw.owner_renounced);

    const isOpenSource =
      this.toBool(raw.is_open_source) ??
      this.toBool(raw.open_source) ??
      this.toBool(raw.verified);

    const isProxy = this.toBool(raw.is_proxy) ?? this.toBool(raw.proxy) ?? null;
    const cannotBuy =
      this.toBool(raw.cannot_buy) ?? this.toBool(raw.buy_restricted) ?? null;
    const buyTax = this.toNumber(raw.buy_tax);
    const sellTax = this.toNumber(raw.sell_tax);

    // holder data
    const holderCount = this.toNumber(raw.holder_count);
    const lpHolderCount = this.toNumber(raw.lp_holder_count);
    const creatorPercent = this.toNumber(raw.creator_percent);
    const ownerPercent = this.toNumber(raw.owner_percent);

    // listing status
    const isInCexRaw = raw.is_in_cex;
    const isInCex =
      typeof isInCexRaw === 'object' && isInCexRaw !== null
        ? this.toBool((isInCexRaw as Record<string, unknown>).listed) ?? true
        : this.toBool(isInCexRaw);
    const cexList = this.extractCexList(raw.is_in_cex);
    const isInDex = this.toBool(raw.is_in_dex);

    // additional risk flags
    const transferPausable = this.toBool(raw.transfer_pausable);
    const selfdestruct = this.toBool(raw.selfdestruct);
    const externalCall = this.toBool(raw.external_call);
    const honeypotWithSameCreator = this.toBool(raw.honeypot_with_same_creator);
    const trustList = this.toBool(raw.trust_list);
    const isAntiWhale = this.toBool(raw.is_anti_whale);
    const transferTax = this.toNumber(raw.transfer_tax);

    const riskItems: SecurityRiskItem[] = [];
    let score = this.toNumber(raw.risk_score) ?? 0;

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
    if (selfdestruct === true) {
      riskItems.push({
        code: 'SELFDESTRUCT',
        severity: 'high',
        message: 'Contract contains selfdestruct capability.',
      });
      score += 30;
    }
    if (honeypotWithSameCreator === true) {
      riskItems.push({
        code: 'HONEYPOT_CREATOR',
        severity: 'medium',
        message: 'Contract creator has created honeypot tokens before.',
      });
      score += 25;
    }
    if (trustList === false && isInCex !== true) {
      riskItems.push({
        code: 'TRUST_LIST_MISSING',
        severity: 'low',
        message: 'Not on trust list and not listed on major CEX.',
      });
      score += 5;
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
      holderCount,
      lpHolderCount,
      creatorPercent,
      ownerPercent,
      isInCex,
      cexList,
      isInDex,
      transferPausable,
      selfdestruct,
      externalCall,
      honeypotWithSameCreator,
      trustList,
      isAntiWhale,
      transferTax,
      asOf: new Date().toISOString(),
      sourceUsed: 'goplus',
      degraded: false,
    };
  }

  private extractCexList(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.cex_list)) {
      return obj.cex_list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private toGoPlusChainId(chain: string): string | null {
    const normalized = chain.trim().toLowerCase();
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
      optimism: '10',
      op: '10',
      solana: 'solana',
      sol: 'solana',
    };
    return mapping[normalized] ?? null;
  }

  private resolveOwnerRenounced(input: {
    ownerAddress: string | null;
    canTakeBackOwnership: boolean | null;
    hiddenOwner: boolean | null;
  }): boolean | null {
    if (input.canTakeBackOwnership === true || input.hiddenOwner === true) {
      return false;
    }

    if (input.ownerAddress === null) {
      return null;
    }

    const normalized = input.ownerAddress.trim().toLowerCase();
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

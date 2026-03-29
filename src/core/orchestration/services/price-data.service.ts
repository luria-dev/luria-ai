import { Injectable } from '@nestjs/common';

type PriceData = {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
};

@Injectable()
export class PriceDataService {
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';

  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const coinId = this.symbolToCoinId(symbol);
      const response = await fetch(
        `${this.COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
        {
          signal: AbortSignal.timeout(3000),
        },
      );

      if (!response.ok) return null;

      const data = await response.json();
      const market = data.market_data;

      return {
        symbol: symbol.toUpperCase(),
        price: market.current_price.usd,
        change24h: market.price_change_percentage_24h,
        high24h: market.high_24h.usd,
        low24h: market.low_24h.usd,
      };
    } catch {
      return null;
    }
  }

  private symbolToCoinId(symbol: string): string {
    const map: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      BNB: 'binancecoin',
      XRP: 'ripple',
      ADA: 'cardano',
      DOGE: 'dogecoin',
      MATIC: 'matic-network',
      DOT: 'polkadot',
      AVAX: 'avalanche-2',
    };
    return map[symbol.toUpperCase()] || symbol.toLowerCase();
  }
}

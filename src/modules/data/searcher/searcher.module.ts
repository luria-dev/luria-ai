import { Module } from '@nestjs/common';
import { SearcherService } from './searcher.service';
import { MarketModule } from '../market/market.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [MarketModule, CacheModule],
  providers: [SearcherService],
  exports: [SearcherService],
})
export class SearcherModule {}

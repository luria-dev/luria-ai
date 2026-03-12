import { Module } from '@nestjs/common';
import { SearcherService } from './searcher.service';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [MarketModule],
  providers: [SearcherService],
  exports: [SearcherService],
})
export class SearcherModule {}

import { Module } from '@nestjs/common';
import { FundamentalsService } from './fundamentals.service';

@Module({
  providers: [FundamentalsService],
  exports: [FundamentalsService],
})
export class FundamentalsModule {}

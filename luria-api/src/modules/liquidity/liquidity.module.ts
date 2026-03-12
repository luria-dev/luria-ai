import { Module } from '@nestjs/common';
import { LiquidityService } from './liquidity.service';

@Module({
  providers: [LiquidityService],
  exports: [LiquidityService],
})
export class LiquidityModule {}

import { Module } from '@nestjs/common';
import { TokenomicsService } from './tokenomics.service';

@Module({
  providers: [TokenomicsService],
  exports: [TokenomicsService],
})
export class TokenomicsModule {}

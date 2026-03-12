import { Module } from '@nestjs/common';
import { OnchainService } from './onchain.service';

@Module({
  providers: [OnchainService],
  exports: [OnchainService],
})
export class OnchainModule {}

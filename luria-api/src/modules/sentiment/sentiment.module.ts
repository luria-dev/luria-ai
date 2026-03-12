import { Module } from '@nestjs/common';
import { SentimentService } from './sentiment.service';

@Module({
  providers: [SentimentService],
  exports: [SentimentService],
})
export class SentimentModule {}

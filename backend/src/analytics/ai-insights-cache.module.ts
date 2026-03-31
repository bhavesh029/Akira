import { Module } from '@nestjs/common';
import { AiInsightsCacheService } from './ai-insights-cache.service';

@Module({
  providers: [AiInsightsCacheService],
  exports: [AiInsightsCacheService],
})
export class AiInsightsCacheModule {}

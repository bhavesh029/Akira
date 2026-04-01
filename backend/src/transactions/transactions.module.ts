import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { AiInsightsCacheModule } from '../analytics/ai-insights-cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    AccountsModule,
    AiInsightsCacheModule,
  ],
  providers: [TransactionsService],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}

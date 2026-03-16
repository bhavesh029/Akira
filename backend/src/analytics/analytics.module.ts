import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Transaction } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Account]),
    DocumentsModule,
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController]
})
export class AnalyticsModule {}

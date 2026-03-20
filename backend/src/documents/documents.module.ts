import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { Transaction } from '../entities/transaction.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SupabaseStorageService } from './supabase-storage.service';
import { GeminiService } from './gemini.service';
import { ExtractionService } from './extraction.service';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Transaction]),
    AccountsModule,
  ],
  providers: [DocumentsService, SupabaseStorageService, GeminiService, ExtractionService],
  controllers: [DocumentsController],
  exports: [DocumentsService, SupabaseStorageService, GeminiService],
})
export class DocumentsModule {}

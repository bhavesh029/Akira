import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { Transaction } from '../entities/transaction.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SupabaseStorageService } from './supabase-storage.service';
import { GeminiService } from './gemini.service';
import { ExtractionService } from './extraction.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, Transaction])],
  providers: [DocumentsService, SupabaseStorageService, GeminiService, ExtractionService],
  controllers: [DocumentsController],
  exports: [DocumentsService, SupabaseStorageService],
})
export class DocumentsModule {}

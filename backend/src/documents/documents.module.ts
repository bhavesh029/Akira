import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SupabaseStorageService } from './supabase-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  providers: [DocumentsService, SupabaseStorageService],
  controllers: [DocumentsController],
  exports: [DocumentsService, SupabaseStorageService],
})
export class DocumentsModule {}

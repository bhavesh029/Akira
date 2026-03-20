import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { SupabaseStorageService } from './supabase-storage.service';
import { ExtractionService } from './extraction.service';
import { AccountsService } from '../accounts/accounts.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    private readonly storageService: SupabaseStorageService,
    @Inject(forwardRef(() => ExtractionService))
    private readonly extractionService: ExtractionService,
    private readonly accountsService: AccountsService,
  ) {}

  async upload(
    userId: number,
    dto: CreateDocumentDto,
    file: Express.Multer.File,
  ): Promise<Document & { download_url?: string }> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // Validate account ownership if accountId is provided
    if (dto.accountId != null) {
      await this.accountsService.findOne(dto.accountId, userId);
    }

    // Generate unique storage path: userId/uuid-originalname
    const fileExt = file.originalname.split('.').pop();
    const storagePath = `${userId}/${uuidv4()}.${fileExt}`; // uuid keeps storage paths unique

    // Upload to Supabase Storage
    await this.storageService.upload(storagePath, file.buffer, file.mimetype);

    // Create DB record
    const document = this.documentsRepository.create({
      ...dto,
      userId,
      file_url: storagePath,
    });

    const saved = await this.documentsRepository.save(document);

    // Trigger AI extraction asynchronously (fire-and-forget)
    this.extractionService.process(saved, dto.password).catch((err) => {
      // Errors are already handled inside process(), this is a safety net
      console.error('Extraction trigger error:', err);
    });

    // Return with a signed download URL
    const download_url = await this.storageService.getSignedUrl(storagePath);
    return { ...saved, download_url };
  }

  async findAllByUser(userId: number, accountId?: number): Promise<Document[]> {
    const where: any = { userId };
    if (accountId != null) {
      where.accountId = accountId;
    }

    return this.documentsRepository.find({
      where,
      relations: ['account'],
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: number, userId: number): Promise<Document & { download_url?: string }> {
    const document = await this.documentsRepository.findOne({
      where: { id, userId },
      relations: ['account'],
    });

    if (!document) {
      throw new NotFoundException(`Document with ID "${id}" not found`);
    }

    // Generate signed download URL if file exists
    let download_url: string | undefined;
    if (document.file_url) {
      try {
        download_url = await this.storageService.getSignedUrl(document.file_url);
      } catch {
        // File might not exist in storage, continue without URL
      }
    }

    return { ...document, download_url };
  }

  async update(id: number, userId: number, dto: UpdateDocumentDto): Promise<Document> {
    const document = await this.documentsRepository.findOne({
      where: { id, userId },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID "${id}" not found`);
    }

    // Validate account ownership if accountId is being updated
    if (dto.accountId != null) {
      await this.accountsService.findOne(dto.accountId, userId);
    }

    Object.assign(document, dto);
    return this.documentsRepository.save(document);
  }

  async remove(id: number, userId: number): Promise<void> {
    const document = await this.documentsRepository.findOne({
      where: { id, userId },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID "${id}" not found`);
    }

    // Delete file from Supabase Storage
    if (document.file_url) {
      await this.storageService.remove(document.file_url);
    }

    await this.documentsRepository.remove(document);
  }

  async countByUser(userId: number): Promise<number> {
    return this.documentsRepository.count({ where: { userId } });
  }
}

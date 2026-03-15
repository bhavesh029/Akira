import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseStorageService {
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  private readonly logger = new Logger(SupabaseStorageService.name);

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')!;
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!;
    this.bucket = this.configService.get<string>('SUPABASE_STORAGE_BUCKET', 'Statements');

    this.supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  /**
   * Upload a file buffer to Supabase Storage.
   * @param path - Storage path (e.g. "user-uuid/filename.pdf")
   * @param fileBuffer - The file buffer
   * @param contentType - MIME type of the file
   * @returns The storage path of the uploaded file
   */
  async upload(path: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, fileBuffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      this.logger.error(`Failed to upload file to ${path}: ${error.message}`);
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return path;
  }

  /**
   * Get a signed URL for private file download.
   * @param path - Storage path
   * @param expiresIn - URL expiry in seconds (default: 1 hour)
   */
  async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      this.logger.error(`Failed to create signed URL for ${path}: ${error?.message}`);
      throw new Error(`Failed to generate download URL`);
    }

    return data.signedUrl;
  }

  /**
   * Delete a file from Supabase Storage.
   */
  async remove(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([path]);

    if (error) {
      this.logger.warn(`Failed to delete file ${path}: ${error.message}`);
    }
  }
}

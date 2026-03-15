import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export interface ExtractedTransaction {
  transaction_date: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  description?: string;
  category?: string;
}

const EXTRACTION_PROMPT = `You are a financial document parser. Analyze the following bank statement text and extract ALL individual transactions.

For each transaction, return:
- transaction_date: in YYYY-MM-DD format
- amount: numeric value (positive number, no currency symbols)
- type: "CREDIT" for money received/deposited, "DEBIT" for money spent/withdrawn
- description: vendor name or transaction description (keep it concise)
- category: one of: Food, Shopping, Transport, Bills, Salary, Transfer, ATM, Entertainment, Health, Education, Rent, Other

Return ONLY a valid JSON array. No markdown, no explanation. If no transactions found, return [].

Example output:
[{"transaction_date":"2026-03-01","amount":1500.00,"type":"DEBIT","description":"Amazon Purchase","category":"Shopping"}]

Bank statement text:
`;

@Injectable()
export class GeminiService {
  private readonly model: GenerativeModel;
  private readonly visionModel: GenerativeModel;
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')!;
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    this.visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  /**
   * Extract transactions from text content (text-based PDFs).
   */
  async extractTransactionsFromText(text: string): Promise<ExtractedTransaction[]> {
    this.logger.log('Extracting transactions from text...');
    
    const result = await this.withRetry(() =>
      this.model.generateContent(EXTRACTION_PROMPT + text)
    );
    const response = result.response.text();
    
    return this.parseResponse(response);
  }

  /**
   * Extract transactions from file bytes (scanned PDFs / images).
   * Uses Gemini's multimodal capability.
   */
  async extractTransactionsFromFile(
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedTransaction[]> {
    this.logger.log(`Extracting transactions from file (${mimeType}) via vision...`);

    const result = await this.withRetry(() =>
      this.visionModel.generateContent([
        EXTRACTION_PROMPT + '\n[See attached document]',
        {
          inlineData: {
            data: fileBuffer.toString('base64'),
            mimeType,
          },
        },
      ])
    );

    const response = result.response.text();
    return this.parseResponse(response);
  }

  /**
   * Helper to add exponential backoff for 429 Too Many Requests errors.
   */
  private async withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        // Check if it's a 429 rate limit
        if (error?.status === 429 || error?.message?.includes('429')) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          this.logger.warn(`Rate limit hit (429). Retrying in ${Math.round(delay)}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // If it throws limit: 0 or isn't a 429, we still pass the error along eventually
        // But for limit: 0, it will loop if the text includes '429', so we handle that specifically:
        if (error?.message?.includes('limit: 0')) {
          this.logger.error('Gemini Free Tier limit is ZERO in your region/account. Please enable billing on your Google API project.');
          throw error; // No point retrying a zero limit
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Parse the LLM JSON response into typed transactions.
   */
  private parseResponse(response: string): ExtractedTransaction[] {
    try {
      // Strip markdown code fences if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        this.logger.warn('Gemini response was not an array, returning empty');
        return [];
      }

      // Validate and sanitize each transaction
      return parsed
        .filter((t: any) => t.transaction_date && t.amount != null && t.type)
        .map((t: any) => ({
          transaction_date: String(t.transaction_date),
          amount: Math.abs(Number(t.amount)),
          type: t.type === 'CREDIT' ? 'CREDIT' : 'DEBIT',
          description: t.description ? String(t.description).slice(0, 255) : undefined,
          category: t.category ? String(t.category).slice(0, 100) : 'Other',
        }));
    } catch (err) {
      this.logger.error(`Failed to parse Gemini response: ${err}`);
      this.logger.debug(`Raw response: ${response.slice(0, 500)}`);
      return [];
    }
  }
}

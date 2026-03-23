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

const EXTRACTION_PROMPT = `You are a financial document parser. Extract ALL individual transactions from the bank statement.

CRITICAL - Financial Accuracy (this is a financial application):
- Extract ONLY what you actually see in the document. NEVER guess, invent, approximate, or hallucinate amounts or dates.
- Amounts must match the document EXACTLY, including decimal places (e.g. 1234.56 not 1234.5 or 1235).
- If a number is unclear or partially obscured, OMIT that transaction rather than guessing.
- Date format must be YYYY-MM-DD. Use the exact date shown in the document.

For each transaction, return:
- transaction_date: in YYYY-MM-DD format (exact date from document)
- amount: numeric value (positive number, no currency symbols, exact value with 2 decimal places)
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

  /** Low temperature for extraction to reduce hallucination and ensure deterministic, accurate output */
  private readonly extractionConfig = {
    temperature: 0.1,
    topP: 0.95,
    maxOutputTokens: 8192,
  };

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')!;
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: this.extractionConfig,
    });
    this.visionModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: this.extractionConfig,
    });
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
  /** Extra instructions for vision/OCR extraction - scanned documents require careful character recognition */
  private readonly VISION_PROMPT_SUFFIX = `
[See attached bank statement document - scanned PDF or image]
When reading numbers from the image: double-check each digit. Common OCR errors: 0/O, 1/I/l, 5/S, 6/8, 3/8. Ensure amounts and dates are read with precision.`;

  async extractTransactionsFromFile(
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedTransaction[]> {
    this.logger.log(`Extracting transactions from file (${mimeType}) via vision...`);

    const result = await this.withRetry(() =>
      this.visionModel.generateContent([
        EXTRACTION_PROMPT + this.VISION_PROMPT_SUFFIX,
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

  /** Max amount allowed - filters out obvious OCR/LLM errors (e.g. wrong scale) */
  private static readonly MAX_AMOUNT = 999_999_999.99;

  /** Validate YYYY-MM-DD date format */
  private static isValidDate(dateStr: string): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!match) return false;
    const [, y, m, d] = match;
    const year = parseInt(y!, 10);
    const month = parseInt(m!, 10);
    const day = parseInt(d!, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  /** Validate amount: positive, finite, reasonable range, rounded to 2 decimals */
  private static sanitizeAmount(value: unknown): number | null {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (num > GeminiService.MAX_AMOUNT) return null;
    return Math.round(num * 100) / 100;
  }

  /**
   * Parse the LLM JSON response into typed transactions.
   * Validates amounts and dates to filter out OCR/LLM errors.
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

      const results: ExtractedTransaction[] = [];
      let rejectedCount = 0;

      for (const t of parsed) {
        if (!t.transaction_date || t.amount == null || !t.type) {
          rejectedCount++;
          continue;
        }

        const dateStr = String(t.transaction_date).trim();
        const amount = GeminiService.sanitizeAmount(t.amount);

        if (!GeminiService.isValidDate(dateStr)) {
          this.logger.warn(
            `Rejected transaction: invalid date "${dateStr}" (amount: ${t.amount}, desc: ${t.description})`,
          );
          rejectedCount++;
          continue;
        }

        if (amount === null) {
          this.logger.warn(
            `Rejected transaction: invalid amount "${t.amount}" (date: ${dateStr}, desc: ${t.description})`,
          );
          rejectedCount++;
          continue;
        }

        results.push({
          transaction_date: dateStr,
          amount,
          type: t.type === 'CREDIT' ? 'CREDIT' : 'DEBIT',
          description: t.description ? String(t.description).slice(0, 255) : undefined,
          category: t.category ? String(t.category).slice(0, 100) : 'Other',
        });
      }

      if (rejectedCount > 0) {
        this.logger.log(
          `Filtered out ${rejectedCount} invalid transaction(s) during validation`,
        );
      }

      return results;
    } catch (err) {
      this.logger.error(`Failed to parse Gemini response: ${err}`);
      this.logger.debug(`Raw response: ${response.slice(0, 500)}`);
      return [];
    }
  }

  /**
   * Generates AI insights based on a generic prompt.
   * Expects the LLM to return a JSON object, parsed and returned as any.
   */
  async generateInsights(prompt: string): Promise<any> {
    this.logger.log('Generating AI insights...');
    
    const result = await this.withRetry(() =>
      this.model.generateContent(prompt)
    );
    const response = result.response.text();

    try {
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      return JSON.parse(cleaned);
    } catch (err) {
      this.logger.error(`Failed to parse AI insights JSON: ${err}`);
      return {
        summary: "Failed to generate structured insights. Please try again.",
        subscriptions: [],
        anomalies: []
      };
    }
  }
}

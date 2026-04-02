import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type {
  FinanceChatFilters,
  FinanceChatIntent,
  FinanceChatParseResult,
  FinanceChatRelative,
} from '../analytics/finance-chat.types';

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

  /**
   * Maps a natural-language finance question to a structured intent + filters (JSON only).
   */
  async parseFinanceChatIntent(
    userMessage: string,
    accounts: { id: number; bank_name: string }[],
    todayIso: string,
  ): Promise<FinanceChatParseResult> {
    const accountsJson = JSON.stringify(accounts);
    const prompt = `You map user questions about their own transaction data to a strict JSON plan. Output JSON ONLY, no markdown.

Today's date (YYYY-MM-DD): ${todayIso}

User's accounts (use accountId only if the user clearly refers to a specific account id; prefer bankName for bank names):
${accountsJson}

Intent values (pick exactly one):
- sum_debits: total spending (outflow / debits) in the period
- sum_credits: total income / credits in the period
- net_flow: net cashflow (credits minus debits) in the period
- top_category: which category had the highest debit spending in the period
- compare_amount: user asks whether they spent/received/debited/credited a specific amount or threshold (e.g. "did I spend 10k", "at least 5000") — set filters.amount and filters.compareOp
- investment_estimate: questions about investments, SIP, mutual funds, stocks, FD — we match debit transactions whose category/description suggests investments
- clarify: required information is missing (which bank, which dates, etc.)
- unknown: not answerable from transaction aggregates (chitchat, unsupported)

Filters:
- from, to: explicit YYYY-MM-DD if the user gave concrete dates; else null
- relative: use when dates are vague — this_month (calendar month start through today), last_month, last_7_days, last_30_days, this_year, all — or null if from/to are set
- accountId: number if user clearly picks one account id from the list; else null
- bankName: short substring to match bank_name (e.g. "HDFC", "SBI") if user names a bank; else null
- category: if user asks about a specific category name; else null
- amount: numeric threshold in INR when comparing (e.g. 10000 for "10k"); else null
- compareOp: for compare_amount — gte (at least / more than), lte (at most / less than), eq (exactly); default gte when user asks "did I spend 10k" meaning at least

Return exactly this JSON shape:
{"intent":"...","filters":{"from":null,"to":null,"relative":null,"accountId":null,"bankName":null,"category":null,"amount":null,"compareOp":null},"clarifyMessage":null}

If intent is clarify, set clarifyMessage to a single short question for the user.

User message:
${userMessage.trim()}`;

    const result = await this.withRetry(() => this.model.generateContent(prompt));
    const response = result.response.text();
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    try {
      const raw = JSON.parse(cleaned) as Record<string, unknown>;
      return this.normalizeFinanceChatParse(raw);
    } catch (err) {
      this.logger.error(`Failed to parse finance chat JSON: ${err}`);
      return {
        intent: 'unknown',
        filters: this.emptyFilters(),
        clarifyMessage: null,
      };
    }
  }

  private emptyFilters(): FinanceChatFilters {
    return {
      from: null,
      to: null,
      relative: null,
      accountId: null,
      bankName: null,
      category: null,
      amount: null,
      compareOp: null,
    };
  }

  private normalizeFinanceChatParse(raw: Record<string, unknown>): FinanceChatParseResult {
    const intents: FinanceChatIntent[] = [
      'sum_debits',
      'sum_credits',
      'net_flow',
      'top_category',
      'compare_amount',
      'investment_estimate',
      'clarify',
      'unknown',
    ];
    const relatives: FinanceChatRelative[] = [
      'this_month',
      'last_month',
      'last_7_days',
      'last_30_days',
      'this_year',
      'all',
    ];
    const ops = ['gte', 'lte', 'eq'] as const;

    const intentRaw = raw.intent;
    const intent =
      typeof intentRaw === 'string' && intents.includes(intentRaw as FinanceChatIntent)
        ? (intentRaw as FinanceChatIntent)
        : 'unknown';

    const f = raw.filters;
    const filtersObj = f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, unknown>) : {};

    let relative: FinanceChatRelative | null = null;
    const rel = filtersObj.relative;
    if (typeof rel === 'string' && relatives.includes(rel as FinanceChatRelative)) {
      relative = rel as FinanceChatRelative;
    }

    let compareOp: 'gte' | 'lte' | 'eq' | null = null;
    const co = filtersObj.compareOp;
    if (typeof co === 'string' && ops.includes(co as 'gte' | 'lte' | 'eq')) {
      compareOp = co as 'gte' | 'lte' | 'eq';
    }

    let accountId: number | null = null;
    if (typeof filtersObj.accountId === 'number' && Number.isFinite(filtersObj.accountId)) {
      accountId = Math.floor(filtersObj.accountId);
    } else if (typeof filtersObj.accountId === 'string' && /^\d+$/.test(filtersObj.accountId)) {
      accountId = parseInt(filtersObj.accountId, 10);
    }

    let amount: number | null = null;
    if (typeof filtersObj.amount === 'number' && Number.isFinite(filtersObj.amount)) {
      amount = filtersObj.amount;
    } else if (typeof filtersObj.amount === 'string' && filtersObj.amount.trim()) {
      const n = parseFloat(filtersObj.amount.replace(/,/g, ''));
      if (!Number.isNaN(n)) amount = n;
    }

    const filters: FinanceChatFilters = {
      from: typeof filtersObj.from === 'string' ? filtersObj.from : null,
      to: typeof filtersObj.to === 'string' ? filtersObj.to : null,
      relative,
      accountId,
      bankName: typeof filtersObj.bankName === 'string' ? filtersObj.bankName : null,
      category: typeof filtersObj.category === 'string' ? filtersObj.category : null,
      amount,
      compareOp,
    };

    const clarifyMessage =
      typeof raw.clarifyMessage === 'string' && raw.clarifyMessage.trim()
        ? raw.clarifyMessage.trim()
        : null;

    return { intent, filters, clarifyMessage };
  }
}

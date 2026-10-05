import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  type EmbedContentRequest,
  type GenerationConfig,
} from '@google/generative-ai';
import type {
  FinanceChatFilters,
  FinanceChatIntent,
  FinanceChatParseResult,
  FinanceChatRelative,
} from '../analytics/finance-chat.types';

// Matches the dimension DocumentChunk.embedding (vector(768)) is declared
// with. gemini-embedding-001 defaults to 3072 dims (Matryoshka
// representation learning) but accepts an explicit outputDimensionality —
// not yet in @google/generative-ai@0.24.1's EmbedContentRequest type even
// though the REST API accepts it, hence the intersection type below.
const EMBEDDING_DIMENSIONS = 768;
type EmbedRequestWithDimensions = EmbedContentRequest & {
  outputDimensionality: number;
};

export interface DocumentBalances {
  opening_balance: number | null;
  closing_balance: number | null;
}

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

const BALANCE_EXTRACTION_PROMPT = `You are a financial document parser. Find the account's opening and closing balance for this statement period, if explicitly printed in the document (e.g. "Opening Balance", "Balance Forward", "Closing Balance", "Balance Carried Forward").

CRITICAL - Financial Accuracy:
- Only report a balance you can actually see printed in the text. NEVER calculate, estimate, or infer one.
- If a balance is not clearly present, set it to null rather than guessing.

Return ONLY a valid JSON object, no markdown, no explanation:
{"opening_balance": <number or null>, "closing_balance": <number or null>}

Bank statement text:
`;

@Injectable()
export class GeminiService {
  private readonly model: GenerativeModel;
  private readonly visionModel: GenerativeModel;
  private readonly embeddingModel: GenerativeModel;
  private readonly logger = new Logger(GeminiService.name);

  /**
   * Low temperature for extraction to reduce hallucination and ensure
   * deterministic, accurate output. `thinkingConfig.thinkingBudget: 0`
   * disables gemini-2.5-flash's default "thinking" pass — not yet in
   * @google/generative-ai@0.24.1's GenerationConfig type even though the
   * REST API accepts it, hence the cast. This isn't a cost/latency nicety:
   * without it, thinking tokens count against maxOutputTokens and can eat
   * almost the entire budget (observed: 7861 of 8192 tokens on a real
   * statement), truncating the visible JSON mid-array and silently
   * discarding every transaction after the cutoff — these are structured
   * extraction/classification tasks with no need for a reasoning pass.
   */
  private readonly extractionConfig = {
    temperature: 0.1,
    topP: 0.95,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 0 },
  } as GenerationConfig;

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
    this.embeddingModel = genAI.getGenerativeModel({
      model: 'gemini-embedding-001',
    });
  }

  /**
   * Extract transactions from text content (text-based PDFs).
   */
  async extractTransactionsFromText(
    text: string,
  ): Promise<ExtractedTransaction[]> {
    this.logger.log('Extracting transactions from text...');

    const result = await this.withRetry(() =>
      this.model.generateContent(EXTRACTION_PROMPT + text),
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
    this.logger.log(
      `Extracting transactions from file (${mimeType}) via vision...`,
    );

    const result = await this.withRetry(() =>
      this.visionModel.generateContent([
        EXTRACTION_PROMPT + this.VISION_PROMPT_SUFFIX,
        {
          inlineData: {
            data: fileBuffer.toString('base64'),
            mimeType,
          },
        },
      ]),
    );

    const response = result.response.text();
    return this.parseResponse(response);
  }

  /**
   * Embeds a single string (e.g. a user's RAG question) with `gemini-embedding-001`.
   */
  async embedText(text: string): Promise<number[]> {
    const request: EmbedRequestWithDimensions = {
      content: { role: 'user', parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    };
    const result = await this.withRetry(() =>
      this.embeddingModel.embedContent(request),
    );
    return result.embedding.values;
  }

  /**
   * Embeds many strings (e.g. a document's chunks) in one request.
   * Returns [] for an empty input without calling the API.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const requests: EmbedRequestWithDimensions[] = texts.map((text) => ({
      content: { role: 'user', parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }));
    const result = await this.withRetry(() =>
      this.embeddingModel.batchEmbedContents({ requests }),
    );
    return result.embeddings.map((e) => e.values);
  }

  /**
   * Generic single-turn free-text completion — unlike `generateInsights`
   * (which always parses a JSON payload), this returns the model's raw text.
   * Used by Phase 3's grounded RAG answers. Never throws: a failure resolves
   * to '', which the caller treats as "could not generate an answer."
   */
  async generateText(prompt: string): Promise<string> {
    try {
      const result = await this.withRetry(() =>
        this.model.generateContent(prompt),
      );
      return result.response.text().trim();
    } catch (err) {
      const { message } = GeminiService.describeError(err);
      this.logger.error(`Gemini text generation failed: ${message}`);
      return '';
    }
  }

  /** Stringifies an arbitrary unknown value for logging without risking a useless "[object Object]". */
  private static safeString(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  /**
   * Safely extracts a status code and message from an unknown thrown value
   * (the Gemini SDK doesn't export a typed error class), without resorting
   * to `any`.
   */
  private static describeError(err: unknown): {
    status?: number;
    message: string;
  } {
    if (err && typeof err === 'object') {
      const status =
        'status' in err &&
        typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : undefined;
      const message =
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : GeminiService.safeString(err);
      return { status, message };
    }
    return { message: GeminiService.safeString(err) };
  }

  /**
   * Helper to add exponential backoff for 429 Too Many Requests errors.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const { status, message } = GeminiService.describeError(error);
        // Check if it's a 429 rate limit
        if (status === 429 || message.includes('429')) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          this.logger.warn(
            `Rate limit hit (429). Retrying in ${Math.round(delay)}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // If it throws limit: 0 or isn't a 429, we still pass the error along eventually
        // But for limit: 0, it will loop if the text includes '429', so we handle that specifically:
        if (message.includes('limit: 0')) {
          this.logger.error(
            'Gemini Free Tier limit is ZERO in your region/account. Please enable billing on your Google API project.',
          );
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
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
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

  /** Shape of one raw transaction object as parsed from Gemini's JSON response, before validation. */
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }

      const parsed: unknown = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        this.logger.warn('Gemini response was not an array, returning empty');
        return [];
      }

      const results: ExtractedTransaction[] = [];
      let rejectedCount = 0;

      for (const raw of parsed as unknown[]) {
        if (!GeminiService.isRecord(raw)) {
          rejectedCount++;
          continue;
        }
        const t = raw;

        if (!t.transaction_date || t.amount == null || !t.type) {
          rejectedCount++;
          continue;
        }

        const dateStr = GeminiService.safeString(t.transaction_date).trim();
        const amount = GeminiService.sanitizeAmount(t.amount);

        if (!GeminiService.isValidDate(dateStr)) {
          this.logger.warn(
            `Rejected transaction: invalid date "${dateStr}" (amount: ${GeminiService.safeString(t.amount)}, desc: ${GeminiService.safeString(t.description)})`,
          );
          rejectedCount++;
          continue;
        }

        if (amount === null) {
          this.logger.warn(
            `Rejected transaction: invalid amount "${GeminiService.safeString(t.amount)}" (date: ${dateStr}, desc: ${GeminiService.safeString(t.description)})`,
          );
          rejectedCount++;
          continue;
        }

        results.push({
          transaction_date: dateStr,
          amount,
          type: t.type === 'CREDIT' ? 'CREDIT' : 'DEBIT',
          description: t.description
            ? GeminiService.safeString(t.description).slice(0, 255)
            : undefined,
          category: t.category
            ? GeminiService.safeString(t.category).slice(0, 100)
            : 'Other',
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
   * Extracts the statement's opening/closing balance (if explicitly printed)
   * for Phase 1 reconciliation. Never fails the caller — any error or
   * unparseable response resolves to {opening_balance: null, closing_balance: null},
   * which extraction.service.ts treats as "no balance found" (reconciliation_status
   * NOT_APPLICABLE), not a hard failure.
   */
  async extractDocumentBalances(text: string): Promise<DocumentBalances> {
    this.logger.log('Extracting document opening/closing balances...');

    try {
      const result = await this.withRetry(() =>
        this.model.generateContent(BALANCE_EXTRACTION_PROMPT + text),
      );
      return this.parseBalanceResponse(result.response.text());
    } catch (err) {
      this.logger.warn(
        `Failed to extract document balances: ${GeminiService.describeError(err).message}`,
      );
      return { opening_balance: null, closing_balance: null };
    }
  }

  private parseBalanceResponse(response: string): DocumentBalances {
    try {
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      const parsed: unknown = JSON.parse(cleaned);
      if (!GeminiService.isRecord(parsed)) {
        return { opening_balance: null, closing_balance: null };
      }
      return {
        opening_balance: GeminiService.sanitizeBalance(parsed.opening_balance),
        closing_balance: GeminiService.sanitizeBalance(parsed.closing_balance),
      };
    } catch (err) {
      this.logger.warn(`Failed to parse balance JSON: ${err}`);
      return { opening_balance: null, closing_balance: null };
    }
  }

  /** Unlike sanitizeAmount, a balance may legitimately be zero or negative (overdraft). */
  private static sanitizeBalance(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100) / 100;
  }

  /**
   * Generates AI insights based on a generic prompt.
   * Expects the LLM to return a JSON object, parsed and returned as any.
   */
  async generateInsights(prompt: string): Promise<any> {
    this.logger.log('Generating AI insights...');

    let response: string;
    try {
      const result = await this.withRetry(() =>
        this.model.generateContent(prompt),
      );
      response = result.response.text();
    } catch (err: unknown) {
      // A failed API call here (billing/quota exhausted, outage, bad key,
      // etc.) must never propagate as an unhandled 500 that leaves the
      // insights panel silently blank — report it as a (non-fatal) insights
      // failure instead, same shape as a JSON-parse failure below.
      const { status, message } = GeminiService.describeError(err);
      const isBilling =
        status === 402 || /prepayment|billing|quota/i.test(message);
      this.logger.error(`Gemini insights request failed: ${message}`);
      return {
        summary: isBilling
          ? 'AI insights are temporarily unavailable — the Gemini API key has run out of billing credits. Add credits at https://ai.studio/projects to restore this.'
          : 'AI insights are temporarily unavailable. Please try again shortly.',
        subscriptions: [],
        anomalies: [],
      };
    }

    try {
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      return JSON.parse(cleaned);
    } catch (err) {
      this.logger.error(`Failed to parse AI insights JSON: ${err}`);
      return {
        summary: 'Failed to generate structured insights. Please try again.',
        subscriptions: [],
        anomalies: [],
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
- top_category: which SINGLE category had the highest debit spending in the period
- category_breakdown: how spending SPLITS across ALL categories in the period (e.g. "break down my spending by category", "how is my spending split this month") — distinct from top_category, which only wants the single highest one
- compare_amount: user asks for a yes/no + the TOTAL (did my spending cross a threshold), not the individual transactions (e.g. "did I spend at least 10k this month") — set filters.amountMin (for "at least"/"over") or filters.amountMax (for "at most"/"under"), or both equal for "exactly"
- compare_periods: user wants to compare this period against the immediately preceding period of the same length (e.g. "how does this month compare to last month", "am I spending more than last month", "is my spending up or down")
- list_transactions: user wants to see/list/find the INDIVIDUAL transactions matching a filter — e.g. "show me transactions over 10,000", "find my Swiggy transactions", "what did I spend on Amazon", "list my debits above 2000 in March", "my last 10 transactions", "biggest transactions this month", "credits above 5000". This is distinct from compare_amount (which answers "yes, you crossed it, total was X") — list_transactions answers "here are the actual transactions." Use the generalized filters below (amountMin/amountMax/description/type/sortBy/sortDir) to express almost any such request.
- investment_estimate: questions about investments, SIP, mutual funds, stocks, FD — we match debit transactions whose category/description suggests investments
- clarify: required information is missing (which bank, which dates, etc.)
- unknown: not answerable from transaction AGGREGATES — chitchat/unsupported, OR the user is asking what their statement's own text says (fees, interest rates, terms, fine print, policies, due dates as printed — e.g. "what is the late payment fee", "what does my statement say about X"). These are answered by reading the statement text itself, not by summing transactions, so they are "unknown" here even though they mention money — do NOT force them into compare_amount/sum_debits/investment_estimate just because a rupee amount or percentage is mentioned.

Filters:
- from, to: explicit YYYY-MM-DD if the user gave concrete dates; else null
- relative: use when dates are vague — this_month (calendar month start through today), last_month, last_7_days, last_30_days, this_year, all — or null if from/to are set
- accountId: number if user clearly picks one account id from the list; else null
- bankName: short substring to match bank_name (e.g. "HDFC", "SBI") if user names a bank; else null
- category: if user asks about a specific category name (sum_debits/sum_credits/list_transactions); else null
- amountMin, amountMax: numeric INR bounds, used by compare_amount and list_transactions alike — "over X"/"above X"/"more than X"/"at least X" → amountMin=X; "under X"/"below X"/"less than X"/"at most X" → amountMax=X; "between X and Y" → amountMin=X, amountMax=Y; "exactly X" → amountMin=X AND amountMax=X. Numbers only, no commas (10000 for "10k").
- description: a vendor/merchant/narration keyword to search for in list_transactions, e.g. "Swiggy", "Amazon", "Netflix", "rent" — taken directly from how the user names the merchant/payee; else null
- type: "DEBIT" or "CREDIT" for list_transactions when the user specifies which side of the ledger (e.g. "credits above 5000" → CREDIT, "payments to X" → DEBIT); else null (list_transactions defaults to DEBIT when null)
- sortBy: "amount" or "date" for list_transactions — "biggest"/"largest"/"highest" → amount; "recent"/"latest"/"newest"/"oldest" → date; else null (defaults to amount)
- sortDir: "asc" or "desc" for list_transactions — "smallest"/"lowest"/"oldest" → asc; "biggest"/"largest"/"newest"/"recent" → desc; else null (defaults to desc)

Return exactly this JSON shape:
{"intent":"...","filters":{"from":null,"to":null,"relative":null,"accountId":null,"bankName":null,"category":null,"amountMin":null,"amountMax":null,"description":null,"type":null,"sortBy":null,"sortDir":null},"clarifyMessage":null}

If intent is clarify, set clarifyMessage to a single short question for the user.

User message:
${userMessage.trim()}`;

    const result = await this.withRetry(() =>
      this.model.generateContent(prompt),
    );
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
      amountMin: null,
      amountMax: null,
      description: null,
      type: null,
      sortBy: null,
      sortDir: null,
    };
  }

  /** Shared by amountMin/amountMax — accepts a JSON number or a comma-formatted numeric string. */
  private static parseNumericFilter(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const n = parseFloat(value.replace(/,/g, ''));
      if (!Number.isNaN(n)) return n;
    }
    return null;
  }

  private normalizeFinanceChatParse(
    raw: Record<string, unknown>,
  ): FinanceChatParseResult {
    const intents: FinanceChatIntent[] = [
      'sum_debits',
      'sum_credits',
      'net_flow',
      'top_category',
      'category_breakdown',
      'compare_amount',
      'compare_periods',
      'list_transactions',
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
    const types = ['DEBIT', 'CREDIT'] as const;
    const sortBys = ['amount', 'date'] as const;
    const sortDirs = ['asc', 'desc'] as const;

    const intentRaw = raw.intent;
    const intent =
      typeof intentRaw === 'string' &&
      intents.includes(intentRaw as FinanceChatIntent)
        ? (intentRaw as FinanceChatIntent)
        : 'unknown';

    const f = raw.filters;
    const filtersObj =
      f && typeof f === 'object' && !Array.isArray(f)
        ? (f as Record<string, unknown>)
        : {};

    let relative: FinanceChatRelative | null = null;
    const rel = filtersObj.relative;
    if (
      typeof rel === 'string' &&
      relatives.includes(rel as FinanceChatRelative)
    ) {
      relative = rel as FinanceChatRelative;
    }

    let accountId: number | null = null;
    if (
      typeof filtersObj.accountId === 'number' &&
      Number.isFinite(filtersObj.accountId)
    ) {
      accountId = Math.floor(filtersObj.accountId);
    } else if (
      typeof filtersObj.accountId === 'string' &&
      /^\d+$/.test(filtersObj.accountId)
    ) {
      accountId = parseInt(filtersObj.accountId, 10);
    }

    let type: 'DEBIT' | 'CREDIT' | null = null;
    const t = filtersObj.type;
    if (typeof t === 'string' && types.includes(t as 'DEBIT' | 'CREDIT')) {
      type = t as 'DEBIT' | 'CREDIT';
    }

    let sortBy: 'amount' | 'date' | null = null;
    const sb = filtersObj.sortBy;
    if (typeof sb === 'string' && sortBys.includes(sb as 'amount' | 'date')) {
      sortBy = sb as 'amount' | 'date';
    }

    let sortDir: 'asc' | 'desc' | null = null;
    const sd = filtersObj.sortDir;
    if (typeof sd === 'string' && sortDirs.includes(sd as 'asc' | 'desc')) {
      sortDir = sd as 'asc' | 'desc';
    }

    const filters: FinanceChatFilters = {
      from: typeof filtersObj.from === 'string' ? filtersObj.from : null,
      to: typeof filtersObj.to === 'string' ? filtersObj.to : null,
      relative,
      accountId,
      bankName:
        typeof filtersObj.bankName === 'string' ? filtersObj.bankName : null,
      category:
        typeof filtersObj.category === 'string' ? filtersObj.category : null,
      amountMin: GeminiService.parseNumericFilter(filtersObj.amountMin),
      amountMax: GeminiService.parseNumericFilter(filtersObj.amountMax),
      description:
        typeof filtersObj.description === 'string'
          ? filtersObj.description
          : null,
      type,
      sortBy,
      sortDir,
    };

    const clarifyMessage =
      typeof raw.clarifyMessage === 'string' && raw.clarifyMessage.trim()
        ? raw.clarifyMessage.trim()
        : null;

    return { intent, filters, clarifyMessage };
  }
}

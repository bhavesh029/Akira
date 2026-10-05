export type FinanceChatIntent =
  | 'sum_debits'
  | 'sum_credits'
  | 'net_flow'
  | 'top_category'
  | 'category_breakdown'
  | 'compare_amount'
  | 'compare_periods'
  | 'list_transactions'
  | 'investment_estimate'
  | 'clarify'
  | 'unknown';

export type FinanceChatRelative =
  | 'this_month'
  | 'last_month'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_year'
  | 'all';

export interface FinanceChatFilters {
  from: string | null;
  to: string | null;
  relative: FinanceChatRelative | null;
  accountId: number | null;
  bankName: string | null;
  category: string | null;
  /**
   * Unified amount-range bounds, used by every intent that filters or
   * compares on amount (compare_amount, list_transactions): "over X" ->
   * amountMin only, "under X" -> amountMax only, "between X and Y" -> both,
   * "exactly X" -> amountMin === amountMax.
   */
  amountMin: number | null;
  amountMax: number | null;
  /** Vendor/merchant/narration substring to search for, e.g. "Swiggy", "Amazon". */
  description: string | null;
  /** Which side of the ledger to search/list; null lets the intent pick its own default. */
  type: 'DEBIT' | 'CREDIT' | null;
  sortBy: 'amount' | 'date' | null;
  sortDir: 'asc' | 'desc' | null;
}

export interface FinanceChatParseResult {
  intent: FinanceChatIntent;
  filters: FinanceChatFilters;
  clarifyMessage: string | null;
}

/** A retrieved-chunk citation backing a Phase 3 RAG-grounded answer. */
export interface FinanceChatSource {
  documentId: number;
  documentTitle: string;
  snippet: string;
}

export interface FinanceChatResult {
  answer: string;
  sources?: FinanceChatSource[];
}

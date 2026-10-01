export type FinanceChatIntent =
  | 'sum_debits'
  | 'sum_credits'
  | 'net_flow'
  | 'top_category'
  | 'compare_amount'
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
  amount: number | null;
  compareOp: 'gte' | 'lte' | 'eq' | null;
}

export interface FinanceChatParseResult {
  intent: FinanceChatIntent;
  filters: FinanceChatFilters;
  clarifyMessage: string | null;
}

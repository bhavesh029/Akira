import api from './client';

export interface AnalyticsMetrics {
  totalInflow: number;
  totalOutflow: number;
  netBalance: number;
  transactionCount: number;
}

export interface CashflowPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface CategoryPoint {
  name: string;
  value: number;
}

export interface AnalyticsSummary {
  metrics: AnalyticsMetrics;
  cashflow: CashflowPoint[];
  topCategories: CategoryPoint[];
  anomalies: any[];
}

export interface AiInsights {
  summary: string;
  subscriptions: Array<{ name: string; amount: number; frequency: string }>;
  anomalies: string[];
}

export interface FinanceChatResponse {
  answer: string;
}

export const analyticsApi = {
  chat: (message: string) =>
    api.post<FinanceChatResponse>('/analytics/chat', { message }),

  getSummary: (accountId?: number, dateRange?: string) => {
    const params: Record<string, string | number> = {};
    if (accountId != null) params.accountId = accountId;
    if (dateRange) params.dateRange = dateRange;
    return api.get<AnalyticsSummary>('/analytics/summary', { params });
  },

  getAiInsights: (accountId?: number, dateRange?: string) => {
    const params: Record<string, string | number> = {};
    if (accountId != null) params.accountId = accountId;
    if (dateRange) params.dateRange = dateRange;
    return api.get<AiInsights>('/analytics/ai-insights', { params });
  },
};

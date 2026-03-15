import api from './client';

export interface TransactionItem {
  id: string;
  transaction_date: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  category: string | null;
  description: string | null;
  accountId: string;
  documentId: string | null;
  account?: {
    id: string;
    bank_name: string;
    account_type: string;
  };
  created_at: string;
}

export interface CreateTransactionPayload {
  transaction_date: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  accountId: string;
  documentId?: string;
  category?: string;
  description?: string;
}

export interface TransactionFilters {
  accountId?: string;
  type?: 'CREDIT' | 'DEBIT';
  category?: string;
  from?: string;
  to?: string;
}

export const transactionsApi = {
  getAll: (filters?: TransactionFilters) =>
    api.get<TransactionItem[]>('/transactions', { params: filters }),

  getOne: (id: string) =>
    api.get<TransactionItem>(`/transactions/${id}`),

  create: (data: CreateTransactionPayload) =>
    api.post<TransactionItem>('/transactions', data),

  update: (id: string, data: Partial<CreateTransactionPayload>) =>
    api.patch<TransactionItem>(`/transactions/${id}`, data),

  remove: (id: string) =>
    api.delete(`/transactions/${id}`),
};

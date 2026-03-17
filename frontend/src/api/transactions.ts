import api from './client';

export interface TransactionItem {
  id: number;
  transaction_date: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  category: string | null;
  description: string | null;
  accountId: number;
  documentId: number | null;
  account?: {
    id: number;
    bank_name: string;
    account_type: string;
  };
  created_at: string;
}

export interface CreateTransactionPayload {
  transaction_date: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  accountId: number;
  documentId?: number;
  category?: string;
  description?: string;
}

export interface TransactionFilters {
  accountId?: number;
  type?: 'CREDIT' | 'DEBIT';
  category?: string;
  from?: string;
  to?: string;
}

export const transactionsApi = {
  getAll: (filters?: TransactionFilters) =>
    api.get<TransactionItem[]>('/transactions', { params: filters }),

  getOne: (id: number) =>
    api.get<TransactionItem>(`/transactions/${id}`),

  create: (data: CreateTransactionPayload) =>
    api.post<TransactionItem>('/transactions', data),

  update: (id: number, data: Partial<CreateTransactionPayload>) =>
    api.patch<TransactionItem>(`/transactions/${id}`, data),

  remove: (id: number) =>
    api.delete(`/transactions/${id}`),
};

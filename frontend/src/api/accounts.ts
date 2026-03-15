import api from './client';

export interface Account {
  id: string;
  bank_name: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'CREDIT_CARD' | 'LOAN' | 'OTHER';
  account_number_last_four: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAccountPayload {
  bank_name: string;
  account_type: Account['account_type'];
  account_number_last_four?: string;
}

export interface UpdateAccountPayload {
  bank_name?: string;
  account_type?: Account['account_type'];
  account_number_last_four?: string;
}

export const accountsApi = {
  getAll: () =>
    api.get<Account[]>('/accounts'),

  getOne: (id: string) =>
    api.get<Account>(`/accounts/${id}`),

  create: (data: CreateAccountPayload) =>
    api.post<Account>('/accounts', data),

  update: (id: string, data: UpdateAccountPayload) =>
    api.patch<Account>(`/accounts/${id}`, data),

  remove: (id: string) =>
    api.delete(`/accounts/${id}`),
};

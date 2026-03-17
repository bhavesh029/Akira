import api from './client';

export interface Account {
  id: number;
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

  getOne: (id: number) =>
    api.get<Account>(`/accounts/${id}`),

  create: (data: CreateAccountPayload) =>
    api.post<Account>('/accounts', data),

  update: (id: number, data: UpdateAccountPayload) =>
    api.patch<Account>(`/accounts/${id}`, data),

  remove: (id: number) =>
    api.delete(`/accounts/${id}`),
};

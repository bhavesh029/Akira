import api from './client';

export type ReconciliationStatus = 'NOT_APPLICABLE' | 'MATCHED' | 'MISMATCH';

export interface DocumentItem {
  id: number;
  title: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  file_url: string | null;
  download_url?: string;
  error_message: string | null;
  accountId: number | null;
  account?: {
    id: number;
    bank_name: string;
    account_type: string;
  };
  opening_balance: number | null;
  closing_balance: number | null;
  reconciled_delta: number | null;
  reconciliation_status: ReconciliationStatus;
  created_at: string;
  updated_at: string;
}

export const documentsApi = {
  getAll: (accountId?: number) => {
    const params = accountId != null ? { accountId } : {};
    return api.get<DocumentItem[]>('/documents', { params });
  },

  getOne: (id: number) =>
    api.get<DocumentItem>(`/documents/${id}`),

  upload: (file: File, title: string, accountId?: number, password?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    if (accountId != null) {
      formData.append('accountId', String(accountId));
    }
    if (password) {
      formData.append('password', password);
    }
    return api.post<DocumentItem>('/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  update: (id: number, data: { title?: string; accountId?: number }) =>
    api.patch<DocumentItem>(`/documents/${id}`, data),

  remove: (id: number) =>
    api.delete(`/documents/${id}`),

  /** Bulk-confirms every unreviewed transaction belonging to this document in one call. */
  confirmReview: (id: number) =>
    api.patch<{ confirmed: number }>(`/documents/${id}/confirm-review`),
};

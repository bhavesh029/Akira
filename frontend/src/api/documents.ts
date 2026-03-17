import api from './client';

export interface DocumentItem {
  id: number;
  title: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  file_url: string | null;
  download_url?: string;
  accountId: number | null;
  account?: {
    id: number;
    bank_name: string;
    account_type: string;
  };
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
};

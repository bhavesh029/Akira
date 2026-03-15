import api from './client';

export interface DocumentItem {
  id: string;
  title: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  file_url: string | null;
  download_url?: string;
  accountId: string | null;
  account?: {
    id: string;
    bank_name: string;
    account_type: string;
  };
  created_at: string;
  updated_at: string;
}

export const documentsApi = {
  getAll: (accountId?: string) => {
    const params = accountId ? { accountId } : {};
    return api.get<DocumentItem[]>('/documents', { params });
  },

  getOne: (id: string) =>
    api.get<DocumentItem>(`/documents/${id}`),

  upload: (file: File, title: string, accountId?: string, password?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    if (accountId) {
      formData.append('accountId', accountId);
    }
    if (password) {
      formData.append('password', password);
    }
    return api.post<DocumentItem>('/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  update: (id: string, data: { title?: string; accountId?: string }) =>
    api.patch<DocumentItem>(`/documents/${id}`, data),

  remove: (id: string) =>
    api.delete(`/documents/${id}`),
};

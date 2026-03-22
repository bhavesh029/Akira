import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('akira_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally — redirect to login with return URL
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('akira_token');
      localStorage.removeItem('akira_user');
      const returnPath = window.location.pathname + window.location.search;
      const redirect = returnPath && returnPath !== '/login' ? `?redirect=${encodeURIComponent(returnPath)}` : '';
      window.location.href = `/login${redirect}`;
    }
    return Promise.reject(error);
  }
);

export default api;

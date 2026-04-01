import api from './client';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
}

export const authApi = {
  login: (data: LoginPayload) =>
    api.post<AuthResponse>('/auth/login', data),

  register: (data: RegisterPayload) =>
    api.post<AuthResponse>('/auth/register', data),
};

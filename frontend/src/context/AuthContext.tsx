import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, type AuthResponse } from '../api/auth';

interface User {
  id: number;
  /** Present for sessions created before name was returned by the API. */
  name?: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('akira_token');
    const savedUser = localStorage.getItem('akira_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        // Corrupted or invalid user data — clear and treat as logged out
        localStorage.removeItem('akira_token');
        localStorage.removeItem('akira_user');
      }
    }
    setIsLoading(false);
  }, []);

  const handleAuthSuccess = (data: AuthResponse) => {
    setToken(data.access_token);
    setUser(data.user);
    localStorage.setItem('akira_token', data.access_token);
    localStorage.setItem('akira_user', JSON.stringify(data.user));
  };

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    handleAuthSuccess(data);
  };

  const register = async (name: string, email: string, password: string) => {
    const { data } = await authApi.register({ name, email, password });
    handleAuthSuccess(data);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('akira_token');
    localStorage.removeItem('akira_user');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

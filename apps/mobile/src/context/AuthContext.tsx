import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, RegisterInput } from '@matinee/shared';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  demoSignIn: () => Promise<boolean>;
  signUp: (data: RegisterInput) => Promise<boolean>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Attempt auto-login demo session
    const initAuth = async () => {
      try {
        const res = await api.demoLogin();
        if (res.success && res.data) {
          setUser(res.data.user);
          setToken(res.data.token);
          api.setToken(res.data.token);
        }
      } catch (_err) {
        // Backend unreachable: allow OFFLINE BROWSING with a local demo profile.
        // No fake token is issued — booking writes require the real backend.
        const fallbackUser: User = {
          id: 'u-1001-demo-user-id',
          email: 'demo@reelpass.app',
          fullName: 'Alex Vance',
          phoneNumber: '+234 803 000 0000',
          role: 'customer',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setUser(fallbackUser);
        setToken(null);
        api.setToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const res = await api.login({ email, password });
      if (res.success && res.data) {
        setUser(res.data.user);
        setToken(res.data.token);
        api.setToken(res.data.token);
        return true;
      }
      return false;
    } catch (_err) {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const demoSignIn = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const res = await api.demoLogin();
      if (res.success && res.data) {
        setUser(res.data.user);
        setToken(res.data.token);
        api.setToken(res.data.token);
        return true;
      }
      return false;
    } catch (_err) {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (data: RegisterInput): Promise<boolean> => {
    setIsLoading(true);
    try {
      const res = await api.register(data);
      if (res.success && res.data) {
        setUser(res.data.user);
        setToken(res.data.token);
        api.setToken(res.data.token);
        return true;
      }
      return false;
    } catch (_err) {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = () => {
    setUser(null);
    setToken(null);
    api.setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        signIn,
        demoSignIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

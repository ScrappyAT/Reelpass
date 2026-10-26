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
    // Keep AuthContext in sync if ApiClient performs proactive token renewal / auto-healing
    api.setTokenListener((newToken, newUser) => {
      setToken(newToken);
      if (newUser) {
        setUser(newUser);
      }
    });

    // Attempt auto-login demo session with graceful retry on device cold boot
    const initAuth = async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await api.demoLogin();
          if (res.success && res.data) {
            setUser(res.data.user);
            setToken(res.data.token);
            api.setToken(res.data.token, true);
            setIsLoading(false);
            return;
          }
        } catch (_err) {
          if (attempt === 1) {
            // Brief pause before retry in case device socket is still initializing
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
      }

      // Backend unreachable: allow OFFLINE BROWSING with a local demo profile.
      // No fake token is issued — booking writes will proactively acquire the real backend token.
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
      api.setToken(null, true);
      setIsLoading(false);
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
        api.setToken(res.data.token, false);
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
        api.setToken(res.data.token, true);
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
        api.setToken(res.data.token, false);
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
    api.setToken(null, false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
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

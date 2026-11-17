import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, type UserDto } from '../services/api';
import { hasPermission, isStaffRole, type Permission } from '../domain/commercePolicy';

interface AuthContextValue {
  user: UserDto | null;
  loading: boolean;
  isStaff: boolean;
  can: (permission: Permission) => boolean;
  refreshUser: () => Promise<UserDto | null>;
  login: (email: string, password: string) => Promise<UserDto>;
  register: (data: { name: string; email: string; phone?: string; password: string }) => Promise<UserDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (): Promise<UserDto | null> => {
    try {
      const res = await authApi.me();
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (data: { name: string; email: string; phone?: string; password: string }) => {
    const res = await authApi.register(data);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const isStaff = user ? isStaffRole(user.roles) : false;
  const can = useCallback((permission: Permission) => (user ? hasPermission(user.roles, permission) : false), [user]);

  return (
    <AuthContext.Provider value={{ user, loading, isStaff, can, refreshUser, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

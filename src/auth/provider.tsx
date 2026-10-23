'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type DependencyList, type ReactNode } from 'react';
import { DatabaseErrorListener } from '@/components/DatabaseErrorListener';
import type { MySQLClient } from '@/lib/mysql-client';

export type User = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getSessionProof: (forceRefresh?: boolean) => Promise<string>;
};

export type ClientAuth = {
  currentUser: User | null;
};

type AuthContextState = {
  user: User | null;
  isUserLoading: boolean;
  auth: ClientAuth;
  mysql: MySQLClient;
};

const MysqlAuthContext = createContext<AuthContextState | null>(null);
const mysqlClient = {} as MySQLClient;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (response.status === 401) {
      setUser(null);
      return;
    }
    if (!response.ok) throw new Error('Unable to load the sign-in session.');
    const result = await response.json();
    const sessionUser = result.user as Omit<User, 'getSessionProof'> | null;
    setUser(sessionUser ? { ...sessionUser, getSessionProof: async () => 'mysql-session' } : null);
  }, []);

  useEffect(() => {
    let active = true;
    refresh()
      .catch(error => console.error('MySQL session initialization failed:', error))
      .finally(() => {
        if (active) setIsUserLoading(false);
      });
    const handleSessionChange = () => {
      void refresh().catch(error => console.error('MySQL session refresh failed:', error));
    };
    window.addEventListener('mysql-auth-changed', handleSessionChange);
    return () => {
      active = false;
      window.removeEventListener('mysql-auth-changed', handleSessionChange);
    };
  }, [refresh]);

  const auth = useMemo<ClientAuth>(() => ({ currentUser: user }), [user]);
  const value = useMemo(() => ({
    user,
    isUserLoading,
    auth,
    mysql: mysqlClient,
  }), [user, isUserLoading, auth]);

  return (
    <MysqlAuthContext.Provider value={value}>
      <DatabaseErrorListener />
      {children}
    </MysqlAuthContext.Provider>
  );
}

export function useMysqlServices() {
  const context = useContext(MysqlAuthContext);
  if (!context) throw new Error('Authentication hooks must be used inside the MySQL auth provider.');
  return context;
}

export function useAuth() {
  return useMysqlServices().auth;
}

export function useMysql() {
  return useMysqlServices().mysql;
}

export function useMemoMysql<T>(factory: () => T, deps: DependencyList): T {
  const memoized = useMemo(factory, deps);
  if (typeof memoized === 'object' && memoized !== null) {
    Object.assign(memoized, { __memo: true });
  }
  return memoized;
}

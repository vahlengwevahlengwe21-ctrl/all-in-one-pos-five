'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/auth/provider';

interface AuthClientProviderProps {
  children: ReactNode;
}

export function AuthClientProvider({ children }: AuthClientProviderProps) {
  return <AuthProvider>{children}</AuthProvider>;
}

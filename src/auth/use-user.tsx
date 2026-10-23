'use client';

import { useMysqlServices } from '@/auth/provider';

/**
 * Hook specifically for accessing the authenticated user's state.
 * This provides the User object, loading status, and any auth errors.
 * @returns The current MySQL-authenticated user and loading state.
 */
export const useUser = () => {
    const { user, isUserLoading } = useMysqlServices();
    return { user, isUserLoading };
};

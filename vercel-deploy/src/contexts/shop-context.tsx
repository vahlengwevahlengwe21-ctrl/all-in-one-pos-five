'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc } from '@/lib/mysql-client';
import { useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { listShopsAction } from '@/app/actions/shop-actions';
import type { Shop, UserProfile } from '@/lib/types';

const STORAGE_KEY = 'all-in-one-pos-selected-shop-id';

type ShopContextValue = {
  shops: Shop[];
  selectedShopId: string;
  setSelectedShopId: (shopId: string) => void;
  isLoading: boolean;
  isSuperAdmin: boolean;
};

const ShopContext = createContext<ShopContextValue | undefined>(undefined);

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const mysql = useMysql();
  const profileRef = useMemoMysql(
    () => (mysql && user ? doc(mysql, 'users', user.uid) : null),
    [mysql, user]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const isSuperAdmin = profile?.role === 'super administrator';

  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopIdState] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user || !isSuperAdmin) {
      setShops([]);
      setSelectedShopIdState('');
      return;
    }

    let isCancelled = false;

    const loadShops = async () => {
      setIsLoading(true);

      try {
        const result = await listShopsAction({ sessionProof: await user.getSessionProof() });
        if (isCancelled || !result.success) {
          return;
        }

        const nextShops = result.shops as Shop[];
        setShops(nextShops);

        const savedShopId = window.localStorage.getItem(STORAGE_KEY) || '';
        const nextSelectedShopId = nextShops.some((shop) => shop.id === savedShopId)
          ? savedShopId
          : nextShops[0]?.id || '';

        setSelectedShopIdState(nextSelectedShopId);

        if (nextSelectedShopId) {
          window.localStorage.setItem(STORAGE_KEY, nextSelectedShopId);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadShops();

    return () => {
      isCancelled = true;
    };
  }, [user, isSuperAdmin]);

  const setSelectedShopId = (shopId: string) => {
    setSelectedShopIdState(shopId);
    if (shopId) {
      window.localStorage.setItem(STORAGE_KEY, shopId);
    }
  };

  const value = useMemo<ShopContextValue>(
    () => ({
      shops,
      selectedShopId,
      setSelectedShopId,
      isLoading,
      isSuperAdmin,
    }),
    [shops, selectedShopId, isLoading, isSuperAdmin]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useSelectedShopContext() {
  const context = useContext(ShopContext);

  if (!context) {
    throw new Error('useSelectedShopContext must be used within a ShopProvider');
  }

  return context;
}

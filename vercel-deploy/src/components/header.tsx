 'use client';

import { useEffect, useState } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { UserNav } from '@/components/user-nav';
import { Badge } from '@/components/ui/badge';
import { useAuth, useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { doc } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSelectedShopContext } from '@/contexts/shop-context';

type HeaderStatus = 'Online' | 'Offline' | 'Online - Locked' | 'Offline - Locked';

export function Header() {
  const [status, setStatus] = useState<HeaderStatus>('Online');
  const auth = useAuth();
  const { user } = useUser();
  const mysql = useMysql();
  const { shops, selectedShopId, setSelectedShopId, isLoading: shopsLoading, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(
    () => (mysql && user ? doc(mysql, 'users', user.uid) : null),
    [mysql, user]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const shopLabel =
    shops.find((shop) => shop.id === selectedShopId)?.shopName ||
    profile?.shopId ||
    'No shop selected';

  useEffect(() => {
    const updateStatus = async () => {
      if (window.electronAPI?.getTerminalStatus) {
        const terminal = await window.electronAPI.getTerminalStatus();
        setStatus(terminal.lockState === 'locked'
          ? terminal.online ? 'Online - Locked' : 'Offline - Locked'
          : terminal.online ? 'Online' : 'Offline');
        if (terminal.online && terminal.lockState === 'unlocked' && window.electronAPI.syncOfflineSales && auth?.currentUser) {
          await window.electronAPI.syncOfflineSales({ sessionProof: await auth.currentUser.getSessionProof(true) });
        }
        return;
      }
      setStatus(navigator.onLine ? 'Online' : 'Offline');
    };
    void updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    const interval = window.setInterval(updateStatus, 30000);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      window.clearInterval(interval);
    };
  }, [auth?.currentUser]);

  return (
    <div className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:h-[60px] lg:px-6">
      <SidebarTrigger className="md:hidden" />
      <div className="w-full flex-1">
        {isSuperAdmin && (
          <div className="flex max-w-sm items-center gap-2 justify-end">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Shop</span>
            <Select
              value={selectedShopId || undefined}
              onValueChange={(value) => setSelectedShopId(value)}
              disabled={shopsLoading || shops.length === 0}
            >
              <SelectTrigger className="w-full min-w-[200px] bg-background">
                <SelectValue placeholder={shopsLoading ? 'Loading shops...' : 'Select a shop'} />
              </SelectTrigger>
              <SelectContent>
                {shops.map((shop) => (
                  <SelectItem key={shop.id} value={shop.id}>
                    {shop.shopName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {!isSuperAdmin && shopLabel && shopLabel !== 'No shop selected' && (
        <Badge variant="outline" className="hidden md:inline-flex">{shopLabel}</Badge>
      )}
      <Badge variant={status.includes('Locked') ? 'destructive' : 'secondary'}>{status}</Badge>
      <UserNav />
    </div>
  );
}

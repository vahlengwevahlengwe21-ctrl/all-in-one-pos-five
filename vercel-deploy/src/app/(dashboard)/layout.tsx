'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Header } from '@/components/header';
import { Nav } from '@/components/nav';
import { useDoc, useFirestore, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useMemoFirebase } from '@/firebase/provider';
import type { UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const pathname = usePathname();
  const router = useRouter();
  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const userProfileRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, 'users', user.uid) : null),
    [firestore, user]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);
  const adminOnlyRoute = ['/dashboard', '/products', '/cash-up', '/stock-count', '/reports', '/sales', '/settings']
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isSalesUser = userProfile?.role === 'sales';
  const isShopOwner = userProfile?.role === 'shop owner';
  const isSuperAdmin = userProfile?.role === 'super administrator';
  const canUseWebDashboard = isSuperAdmin || isShopOwner;
  const isPosRoute = pathname === '/pos' || pathname.startsWith('/pos/');

  useEffect(() => {
    setIsElectron(Boolean(window.electronAPI));
  }, []);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    } else if (!isUserLoading && !isProfileLoading && isSuperAdmin && isPosRoute) {
      router.replace('/dashboard');
    } else if (!isUserLoading && !isProfileLoading && isSalesUser && adminOnlyRoute) {
      router.replace('/pos');
    } else if (!isUserLoading && !isProfileLoading && userProfile?.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [user, isUserLoading, isProfileLoading, isSalesUser, isSuperAdmin, isPosRoute, adminOnlyRoute, userProfile?.mustChangePassword, router]);

  if (isUserLoading || isProfileLoading || isElectron === null || !user || (isSuperAdmin && isPosRoute) || (isSalesUser && adminOnlyRoute) || userProfile?.mustChangePassword) {
    return (
      <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <div className="hidden border-r bg-muted/40 md:block">
          <div className="flex h-full max-h-screen flex-col gap-2">
            <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
              <Skeleton className="h-6 w-6" />
              <Skeleton className="ml-2 h-6 w-24" />
            </div>
            <div className="flex-1">
              <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="mb-2 h-8 w-full" />
                ))}
              </nav>
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
            <Skeleton className="h-8 w-8 md:hidden" />
            <div className="w-full flex-1">
              {/* <Skeleton className="h-8 w-full md:w-2/3 lg:w-1/3" /> */}
            </div>
            <Skeleton className="h-8 w-8 rounded-full" />
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-full w-full" />
          </main>
        </div>
      </div>
    );
  }

  if (!isElectron && !canUseWebDashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <div className="flex justify-center">
            <Image src="/00.png" alt="All In One POS logo" width={100} height={100} className="h-16 w-auto object-contain" />
          </div>
          <h1 className="text-xl font-semibold">Open All In One POS Desktop</h1>
          <p className="text-sm text-muted-foreground">Salespeople must use the registered Electron computer for this shop.</p>
          <p className="text-sm text-muted-foreground">Shop owners and the super administrator can use the live web dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <Sidebar variant="sidebar" className="hidden md:flex">
          <SidebarHeader>
            <div className="flex h-14 items-center gap-2.5 border-b px-4 lg:h-[60px] lg:px-6">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white p-0.5 shadow-sm ring-1 ring-border/70">
                <Image src="/00.png" alt="All In One POS logo" width={72} height={72} className="h-full w-full rounded-lg object-contain object-center" />
              </div>
              <span className="text-lg font-semibold text-primary">All In One POS</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <Nav />
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-col">
          <Header />
          <SidebarInset>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-background">
              {children}
            </main>
          </SidebarInset>
        </div>
      </div>
    </>
  );
}

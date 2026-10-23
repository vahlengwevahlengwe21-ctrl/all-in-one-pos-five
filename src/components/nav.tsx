
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  LayoutDashboard,
  Package,
  ScanLine,
  ShoppingCart,
  History,
  Settings,
  Users,
  Wallet,
  Store,
  SlidersHorizontal,
  CircleHelp,
  Info,
  ShieldCheck,
} from 'lucide-react';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { doc } from '@/lib/mysql-client';
import { UserProfile } from '@/lib/types';
import { Skeleton } from './ui/skeleton';

const topLevelLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['shop owner', 'super administrator'] },
  { href: '/pos', label: 'Point of Sale', icon: ShoppingCart, roles: ['shop owner', 'sales'] },
  { href: '/products', label: 'Products', icon: Package, roles: ['shop owner', 'super administrator'] },
  { href: '/cash-up', label: 'Cash-Up', icon: Wallet, roles: ['shop owner', 'super administrator'] },
  { href: '/stock-count', label: 'Stock Count', icon: ScanLine, roles: ['shop owner', 'super administrator'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, roles: ['shop owner', 'super administrator'] },
  { href: '/sales', label: 'Completed Sales', icon: History, roles: ['shop owner', 'super administrator'] },
  { href: '/help', label: 'Help & Training', icon: CircleHelp, roles: ['shop owner', 'sales', 'super administrator'] },
  { href: '/about', label: 'About', icon: Info, roles: ['shop owner', 'sales', 'super administrator'] },
  { href: '/security', label: 'Security', icon: ShieldCheck, roles: ['shop owner', 'sales', 'super administrator'] },
];

const settingsLinks = [
    { href: '/settings/users', label: 'Users', icon: Users, roles: ['shop owner', 'super administrator'] },
  { href: '/settings/shop-profile', label: 'Shop Profile', icon: Store, roles: ['shop owner'] },
  { href: '/settings/payments', label: 'Payment Setup', icon: Wallet, roles: ['shop owner'] },
  { href: '/settings/billing', label: 'Billing', icon: Wallet, roles: ['shop owner'] },
  { href: '/settings/audit-log', label: 'Audit Log', icon: History, roles: ['shop owner', 'super administrator'] },
    { href: '/settings/pos-operations', label: 'POS Operations', icon: SlidersHorizontal, roles: ['shop owner', 'super administrator'] },
  { href: '/settings/shops', label: 'Shops & Devices', icon: Store, roles: ['super administrator'] },
]


export function Nav() {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const [openCollapsibles, setOpenCollapsibles] = useState({
      settings: pathname.startsWith('/settings'),
  });

  const { user, isUserLoading } = useUser();
  const mysql = useMysql();

  const userProfileRef = useMemoMysql(
    () => (mysql && user ? doc(mysql, 'users', user.uid) : null),
    [mysql, user]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const userRole = userProfile?.role || 'sales';
  const isLoading = isUserLoading || isProfileLoading;

  const isSettingsActive = pathname.startsWith('/settings');

  const handleOpenChange = (collapsible: 'settings') => {
      setOpenCollapsibles(prev => ({ ...prev, [collapsible]: !prev[collapsible] }));
  }

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }


  return (
    <SidebarMenu>
      {topLevelLinks.filter(link => link.roles.includes(userRole)).map((link) => (
        <SidebarMenuItem key={link.href} onClick={handleLinkClick}>
          <SidebarMenuButton
            asChild
            isActive={pathname === link.href}
            className="w-full justify-start"
            tooltip={link.label}
          >
            <Link href={link.href}>
              <link.icon />
              <span>{link.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      
      {(userRole === 'shop owner' || userRole === 'super administrator') && (
        <>          
          <Collapsible open={openCollapsibles.settings} onOpenChange={() => handleOpenChange('settings')}>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                        isActive={isSettingsActive}
                        className="w-full justify-start"
                        tooltip="Settings"
                    >
                        <Settings />
                        <span>Settings</span>
                        <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", openCollapsibles.settings && "rotate-90")} />
                    </SidebarMenuButton>
              </CollapsibleTrigger>
            </SidebarMenuItem>
            <CollapsibleContent>
                <SidebarMenuSub>
                    {settingsLinks.filter(link => link.roles.includes(userRole)).map(link => (
                        <SidebarMenuSubItem key={link.href} onClick={handleLinkClick}>
                            <SidebarMenuSubButton asChild isActive={pathname === link.href || pathname.startsWith(`${link.href}/`)}>
                                <Link href={link.href}>{link.label}</Link>
                            </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                    ))}
                </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </SidebarMenu>
  );
}

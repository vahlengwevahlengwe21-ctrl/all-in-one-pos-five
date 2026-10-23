
'use client';

import Link from 'next/link';
import { useUser, useMysql, useDoc } from '@/auth';
import { initiateSignOut } from '@/auth/non-blocking-login';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMemoMysql } from '@/auth/provider';
import { doc } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import { Badge } from './ui/badge';

export function UserNav() {
  const { user, isUserLoading } = useUser();
  const mysql = useMysql();

  const userProfileRef = useMemoMysql(
    () => (mysql && user ? doc(mysql, 'users', user.uid) : null),
    [mysql, user]
  );
  const { data: userProfile, isLoading: isProfileLoading } =
    useDoc<UserProfile>(userProfileRef);

  const handleLogout = async () => {
    try {
      await initiateSignOut();
    } catch (e) {
      console.error('Failed to sign out:', e);
    }
  };

  const pageIsLoading = isUserLoading || isProfileLoading;

  if (pageIsLoading) {
    return (
      <Button variant="ghost" className="relative h-8 w-8 rounded-full">
        <Avatar className="h-8 w-8">
          <AvatarFallback>...</AvatarFallback>
        </Avatar>
      </Button>
    );
  }

  const userDisplayName = userProfile ? `${userProfile.name} ${userProfile.surname}` : user?.displayName || user?.email;
  const userInitials = userProfile ? `${userProfile.name?.[0] || ''}${userProfile.surname?.[0] || ''}`.toUpperCase() : user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            {user ? (
              <>
                <AvatarImage
                  src={user.photoURL ?? ''}
                  alt={userDisplayName ?? 'User'}
                />
                <AvatarFallback>
                  {userInitials}
                </AvatarFallback>
              </>
            ) : (
              <AvatarFallback>??</AvatarFallback>
            )}
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        {user ? (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-2">
                <p className="text-sm font-medium leading-none">
                  {userDisplayName}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
                {userProfile && (
                  <Badge
                    variant={
                      userProfile.role === 'shop owner' ||
                      userProfile.role === 'super administrator'
                        ? 'default'
                        : 'secondary'
                    }
                    className="capitalize w-fit"
                  >
                    {userProfile.role}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/login">Log In</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

'use client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useCollection, useMysql, useUser, useAuth, useDoc } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collection, doc, query, orderBy, where } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Button } from '../ui/button';
import { Loader2, Trash2, Edit } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { deleteUserAction } from '@/app/actions/user-actions';
import Link from 'next/link';

export function UserList() {
  const mysql = useMysql();
  const { user: currentUser, isUserLoading } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const currentUserProfileRef = useMemoMysql(
    () => (mysql && currentUser ? doc(mysql, 'users', currentUser.uid) : null),
    [mysql, currentUser]
  );
  const { data: currentUserProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(currentUserProfileRef);

  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const usersQuery = useMemoMysql(
    () =>
      mysql
        ? currentUserProfile?.role === 'super administrator'
          ? query(collection(mysql, 'users'), orderBy('createdAt', 'desc'))
          : currentUserProfile?.shopId
            ? query(collection(mysql, 'users'), where('shopId', '==', currentUserProfile.shopId))
            : null
        : null,
    [mysql, currentUserProfile?.role, currentUserProfile?.shopId]
  );
  const { data: users, isLoading: isLoadingUsers } =
    useCollection<UserProfile>(usersQuery);

  const handleDelete = async (userToDelete: UserProfile) => {
    if (!userToDelete || !currentUser) return;

    if (currentUser.uid === userToDelete.id) {
      toast({
        variant: 'destructive',
        title: 'Action Not Allowed',
        description: 'You cannot delete your own account.',
      });
      return;
    }

    setDeletingUserId(userToDelete.id);

    try {
      const result = await deleteUserAction({
        userId: userToDelete.id,
        sessionProof: auth?.currentUser ? await auth.currentUser.getSessionProof() : '',
      });

      if (result.success) {
        toast({
          title: 'User Deleted',
          description: `The account for "${userToDelete.email}" has been permanently removed.`,
        });
      } else {
        throw new Error(
          result.error || 'An unknown error occurred during deletion.'
        );
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Deletion Failed',
        description: error.message,
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  const getRoleVariant = (role: string) => {
    switch (role) {
      case 'shop owner':
      case 'super administrator':
        return 'default';
      case 'sales':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const isProtectedSuperAdmin = (user: UserProfile) =>
    user.role === 'super administrator';

  const getDeleteTitle = (user: UserProfile) => {
    if (currentUser?.uid === user.id) return "You can't delete your own account";
    if (isProtectedSuperAdmin(user)) return 'Protected super administrator';
    return 'Delete user';
  };

  const pageIsLoading = isLoadingUsers || isUserLoading || isProfileLoading;

  if (pageIsLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Full Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Date Added</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users
            ?.filter((user) => !user.hiddenFromUserList && !isProtectedSuperAdmin(user))
            .sort((first, second) => {
              const firstDate = first.createdAt?.toDate?.()?.getTime?.() || 0;
              const secondDate = second.createdAt?.toDate?.()?.getTime?.() || 0;
              return secondDate - firstDate;
            })
            .map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{`${user.name} ${user.surname}`}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge
                  variant={getRoleVariant(user.role)}
                  className="capitalize"
                >
                  {user.role}
                </Badge>
              </TableCell>
              <TableCell>
                {user.createdAt
                  ? format(user.createdAt.toDate(), 'yyyy-MM-dd')
                  : 'N/A'}
              </TableCell>
              <TableCell className="text-right space-x-2">
                <Button variant="outline" size="icon" asChild={!isProtectedSuperAdmin(user)} disabled={isProtectedSuperAdmin(user)} title={isProtectedSuperAdmin(user) ? 'Protected super administrator' : 'Edit user'}>
                  <Link href={`/settings/users/edit/${user.id}`} aria-disabled={isProtectedSuperAdmin(user)} tabIndex={isProtectedSuperAdmin(user) ? -1 : undefined}>
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">Edit user</span>
                  </Link>
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => handleDelete(user)}
                  disabled={
                    !currentUser ||
                    currentUser.uid === user.id ||
                    isProtectedSuperAdmin(user) ||
                    deletingUserId === user.id
                  }
                  title={getDeleteTitle(user)}
                >
                  {deletingUserId === user.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span className="sr-only">Delete user</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

'use client';
import { useParams } from 'next/navigation';
import { useDoc, useMysql } from '@/auth';
import { doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EditUserForm } from '@/components/settings/edit-user-form';

export default function EditUserPage() {
  const params = useParams();
  const { id } = params;
  const mysql = useMysql();

  const userRef = useMemoMysql(
    () => (mysql && id ? doc(mysql, 'users', id as string) : null),
    [mysql, id]
  );
  const { data: user, isLoading } = useDoc<UserProfile>(userRef);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Edit User</h1>
      </div>
      {isLoading && (
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
            <div className='flex gap-2'>
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </CardContent>
        </Card>
      )}
      {user && <EditUserForm user={user} />}
    </div>
  );
}

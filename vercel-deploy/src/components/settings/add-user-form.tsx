

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useMysql,
  useDoc,
  useUser,
  useAuth,
} from '@/auth';
import { doc } from '@/lib/mysql-client';
import { createUserAction } from '@/app/actions/user-actions';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';

const formSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    surname: z.string().min(1, 'Surname is required'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(10, 'Use at least 10 characters'),
    role: z.enum(['shop owner', 'sales']),
  })

type FormData = z.infer<typeof formSchema>;

export function AddUserForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const mysql = useMysql();
  const router = useRouter();
  const { user: currentUser } = useUser();
  const auth = useAuth();

  const userProfileRef = useMemoMysql(
    () =>
      mysql && currentUser
        ? doc(mysql, 'users', currentUser.uid)
        : null,
    [mysql, currentUser]
  );
  const { data: currentUserProfile } = useDoc<UserProfile>(userProfileRef);
  const isCurrentUserAdmin =
    currentUserProfile?.role === 'shop owner' ||
    currentUserProfile?.role === 'super administrator';

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      surname: '',
      email: '',
      password: '',
      role: 'sales',
    },
  });

  async function onSubmit(data: FormData) {
    setIsLoading(true);
    try {
      if (!mysql) throw new Error('MySQL data access is not initialized.');
      if (!auth?.currentUser) {
        throw new Error('You must be logged in as a shop owner or the super administrator.');
      }

      // 1. Create user in Auth via Server Action
      const result = await createUserAction({
        email: data.email,
        name: data.name,
        surname: data.surname,
        role: data.role,
        displayName: `${data.name} ${data.surname}`,
        sessionProof: await auth.currentUser.getSessionProof(),
        shopId: currentUserProfile?.shopId,
        password: data.password,
      });

      if (!result.success || !result.uid) {
        throw new Error(result.error || 'Failed to create user in Auth.');
      }

      toast({
        title: 'User Created!',
        description: `The account for ${data.email} was created. Share the password securely with the user.`,
      });
      form.reset(); // Reset form fields to allow adding another user
    } catch (error: any) {
      console.error('User creation failed:', error);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: error.message || 'An unexpected error occurred.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New User Details</CardTitle>
        <CardDescription>
          Set an initial password for this account. Share it with the user through a secure channel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="John"
                          {...field}
                          autoComplete="given-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="surname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Surname</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Doe"
                          {...field}
                          autoComplete="family-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="new.user@example.com"
                      {...field}
                      autoComplete="off"
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Initial password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} autoComplete="new-password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="sales">Sales</SelectItem>
                      {isCurrentUserAdmin && (
                        <SelectItem value="shop owner">
                          Shop Owner / Manager
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={isLoading}>
                {isLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create User
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => router.push('/settings/users')}
              >
                Done
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

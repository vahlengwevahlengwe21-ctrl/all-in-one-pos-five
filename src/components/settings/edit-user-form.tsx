'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUser, useAuth } from '@/auth';
import { updateUserAction } from '@/app/actions/user-actions';

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
import type { UserProfile } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  surname: z.string().min(1, 'Surname is required'),
  role: z.enum(['shop owner', 'super administrator', 'sales']),
  password: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface EditUserFormProps {
  user: UserProfile;
}

export function EditUserForm({ user }: EditUserFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { user: currentUser } = useUser();
  const auth = useAuth();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: user.name,
      surname: user.surname,
      role: user.role,
      password: '',
    },
  });

  const isEditingSelf = currentUser?.uid === user.id;
  const isProtectedSuperAdmin =
    user.role === 'super administrator';

  async function onSubmit(data: FormData) {
    setIsLoading(true);
    try {
      const result = await updateUserAction({
        userId: user.id,
        sessionProof: auth?.currentUser ? await auth.currentUser.getSessionProof() : '',
        ...data,
        password: data.password || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update user.');
      }

      toast({
        title: 'User Updated!',
        description: `The profile for ${user.email} has been updated.`,
      });
      router.push('/settings/users');
    } catch (error: any) {
      console.error('User update failed:', error);
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
        <CardTitle>Update User Profile</CardTitle>
        <CardDescription>
          Modify the details for <span className="font-medium">{user.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} />
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
                      <Input placeholder="Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditingSelf}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="shop owner">
                        Shop Owner / Manager
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset password (optional)</FormLabel>
                  <FormControl>
                    <Input type="password" minLength={10} placeholder="Leave blank to keep the current password" {...field} autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isEditingSelf && (
                 <Alert variant='default'>
                    <AlertTitle>Editing Your Own Account</AlertTitle>
                    <AlertDescription>
                        You cannot change your own role. Please ask the super administrator to modify it for you.
                    </AlertDescription>
                </Alert>
            )}
            {isProtectedSuperAdmin && (
              <Alert>
                <AlertTitle>Protected Super Administrator</AlertTitle>
                <AlertDescription>
                  This account cannot be edited, deleted, or have its password changed.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isLoading || isProtectedSuperAdmin}>
                {isLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Update User
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

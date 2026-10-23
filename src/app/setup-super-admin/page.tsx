'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function SetupSuperAdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    token: '',
    name: '',
    surname: '',
    email: 'jeff@gmail.com',
    password: '',
    confirmPassword: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast({ variant: 'destructive', title: 'Passwords do not match' });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/setup/super-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: form.token,
          name: form.name,
          surname: form.surname,
          email: form.email,
          password: form.password,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to create the initial administrator.');

      setForm({ token: '', name: '', surname: '', email: '', password: '', confirmPassword: '' });
      toast({ title: 'Administrator created', description: 'You can now sign in.' });
      router.replace('/login');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Setup failed',
        description: error instanceof Error ? error.message : 'Unable to create the initial administrator.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Initial administrator setup</CardTitle>
          <CardDescription>
            This one-time setup works only while the database has no users or administrator roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-token">One-time setup token</Label>
              <Input
                id="setup-token"
                type="password"
                autoComplete="off"
                maxLength={128}
                value={form.token}
                onChange={(event) => setForm({ ...form, token: event.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin-name">Name</Label>
                <Input id="admin-name" maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-surname">Surname</Label>
                <Input id="admin-surname" maxLength={100} value={form.surname} onChange={(event) => setForm({ ...form, surname: event.target.value })} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-email">Administrator email</Label>
              <Input id="admin-email" type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password (at least 12 characters)</Label>
              <Input id="admin-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-password">Confirm password</Label>
              <Input id="admin-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} required />
            </div>
            <Button type="submit" className="w-full" disabled={isSaving}>
              {isSaving ? 'Creating administrator...' : 'Create initial administrator'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

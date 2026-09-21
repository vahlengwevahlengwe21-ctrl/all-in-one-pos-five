'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createShopOwnerAction } from '@/app/actions/shop-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function SetupOwnerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const setupToken = searchParams.get('token') || '';
  const shopName = searchParams.get('shopName') || 'Your shop';
  const [form, setForm] = useState({ name: '', surname: '', email: '', password: '', confirmPassword: '' });
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setupToken) return toast({ variant: 'destructive', title: 'Invalid setup link' });
    if (form.password !== form.confirmPassword) return toast({ variant: 'destructive', title: 'Passwords do not match' });
    setIsSaving(true);
    const result = await createShopOwnerAction({ setupToken, name: form.name, surname: form.surname, email: form.email, password: form.password });
    setIsSaving(false);
    if (!result.success) return toast({ variant: 'destructive', title: 'Setup failed', description: result.error });
    toast({ title: 'Owner account created', description: 'You can now sign in with your new account.' });
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white/5 p-1 shadow-sm ring-1 ring-border/70">
            <Image src="/00.png" alt="All In One POS logo" width={120} height={120} className="h-full w-full rounded-xl object-cover object-center" />
          </div>
          <span className="text-2xl font-semibold">All In One POS</span>
        </div>
        <Card>
          <CardHeader><CardTitle>Set up {shopName}</CardTitle><CardDescription>Create the first administrator account for this shop.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="owner-name">Name</Label><Input id="owner-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div><div className="space-y-2"><Label htmlFor="owner-surname">Surname</Label><Input id="owner-surname" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} required /></div></div>
              <div className="space-y-2"><Label htmlFor="owner-email">Email</Label><Input id="owner-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="space-y-2"><Label htmlFor="owner-password">Password</Label><Input id="owner-password" type="password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              <div className="space-y-2"><Label htmlFor="owner-confirm-password">Confirm password</Label><Input id="owner-confirm-password" type="password" minLength={6} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required /></div>
              <Button type="submit" className="w-full" disabled={isSaving}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Owner Account</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

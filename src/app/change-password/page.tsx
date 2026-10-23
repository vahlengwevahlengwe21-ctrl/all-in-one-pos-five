'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/auth';
import { completePasswordSetupAction } from '@/app/actions/user-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function ChangePasswordPage() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 10) return toast({ variant: 'destructive', title: 'Password too short', description: 'Use at least 10 characters.' });
    if (password !== confirmPassword) return toast({ variant: 'destructive', title: 'Passwords do not match' });
    if (!auth.currentUser) return router.replace('/login');
    setIsSaving(true);
    try {
      const result = await completePasswordSetupAction({ sessionProof: await auth.currentUser.getSessionProof(true), password });
      if (!result.success) throw new Error(result.error || 'Unable to update password.');
      toast({ title: 'Password updated', description: 'Your account is ready to use.' });
      router.replace('/');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Password update failed', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/5 p-1 shadow-sm ring-1 ring-border/70">
            <Image src="/00.png" alt="All In One POS logo" width={120} height={120} className="h-full w-full rounded-xl object-cover object-center" />
          </div>
          <CardTitle>Set your permanent password</CardTitle>
          <CardDescription>Choose a new password for your MySQL account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div>
            <div className="space-y-2"><Label htmlFor="confirm-new-password">Confirm new password</Label><Input id="confirm-new-password" type="password" minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></div>
            <Button type="submit" className="w-full" disabled={isSaving}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue to app</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
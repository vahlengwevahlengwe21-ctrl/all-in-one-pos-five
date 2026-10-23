'use client';

import { useEffect, useState } from 'react';
import { getShopProfileAction, updateShopProfileAction } from '@/app/actions/shop-actions';
import { useDoc, useMysql, useUser } from '@/auth';
import { doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ShopProfileForm() {
  const { user } = useUser();
  const mysql = useMysql();
  const userProfileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);
  const { toast } = useToast();
  const [shopId, setShopId] = useState('');
  const [form, setForm] = useState({ shopName: '', address: '', phone: '', website: '' });
  const [isSaving, setIsSaving] = useState(false);

  const loadProfile = async (sessionProof: string, currentShopId: string) => {
    const result = await getShopProfileAction({ sessionProof, shopId: currentShopId });
    if (result.success && result.shop) {
      setShopId(result.shop.id);
      setForm({ shopName: result.shop.shopName, address: result.shop.address || '', phone: result.shop.phone || '', website: result.shop.website || '' });
    }
  };

  useEffect(() => {
    if (!user || !userProfile?.shopId) return;
    user.getSessionProof().then((sessionProof) => loadProfile(sessionProof, userProfile.shopId!));
  }, [user, userProfile?.shopId]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !shopId) return;
    setIsSaving(true);
    const result = await updateShopProfileAction({ sessionProof: await user.getSessionProof(), shopId, ...form });
    setIsSaving(false);
    toast(result.success ? { title: 'Shop profile saved' } : { variant: 'destructive', title: 'Unable to save profile', description: result.error });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shop Profile</CardTitle>
        <CardDescription>These details appear at the top of every receipt printed by this shop.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="max-w-xl space-y-4">
          <div className="space-y-2"><Label htmlFor="shop-profile-name">Shop name</Label><Input id="shop-profile-name" value={form.shopName} onChange={(event) => setForm({ ...form, shopName: event.target.value })} required /></div>
          <div className="space-y-2"><Label htmlFor="shop-profile-address">Address</Label><Input id="shop-profile-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="shop-profile-phone">Cell / phone number</Label><Input id="shop-profile-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="shop-profile-website">Website</Label><Input id="shop-profile-website" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://example.com" /></div>
          <Button type="submit" disabled={isSaving || !shopId}>{isSaving ? 'Saving...' : 'Save shop profile'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

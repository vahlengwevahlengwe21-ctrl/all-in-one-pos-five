'use client';

import { useEffect, useState } from 'react';
import { createPayFastBillingCheckoutAction, getShopBillingStatusAction } from '@/app/actions/shop-actions';
import { useDoc, useMysql, useUser } from '@/auth';
import { doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function BillingPage() {
  const { user } = useUser();
  const mysql = useMysql();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const { toast } = useToast();
  const [shop, setShop] = useState<{ shopName: string; billingStatus: string; billingExpiresAt: number | null } | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!profile?.shopId || !mysql || !user) return;
    const currentShopId = profile.shopId;
    const currentUser = user;
    getShop();
    async function getShop() {
      const result = await getShopBillingStatusAction({ sessionProof: await currentUser.getSessionProof(), shopId: currentShopId });
      if (result.success && result.shop) setShop(result.shop);
    }
  }, [mysql, profile?.shopId, user]);

  const startPayment = async () => {
    if (!user || !profile?.shopId) return;
    setIsStarting(true);
    const result = await createPayFastBillingCheckoutAction({ sessionProof: await user.getSessionProof(), shopId: profile.shopId });
    if (!result.success || !result.paymentUrl || !result.fields) {
      toast({ variant: 'destructive', title: 'Unable to start payment', description: result.error });
      setIsStarting(false);
      return;
    }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = result.paymentUrl;
    Object.entries(result.fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  };

  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Monthly POS Subscription</CardTitle><CardDescription>Pay securely with PayFast. Your shop unlocks automatically after PayFast confirms payment.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-3"><div><p className="text-sm text-muted-foreground">Shop</p><p className="font-semibold">{shop?.shopName || 'Loading...'}</p></div><div><p className="text-sm text-muted-foreground">Billing status</p><p className="font-semibold">{shop?.billingStatus === 'active' ? 'Active' : 'Payment required'}</p></div><div><p className="text-sm text-muted-foreground">Paid until</p><p className="font-semibold">{shop?.billingExpiresAt ? new Date(shop.billingExpiresAt).toLocaleDateString() : 'Not available'}</p></div></div><Button onClick={startPayment} disabled={isStarting || !profile?.shopId}>{isStarting ? 'Opening PayFast...' : 'Pay monthly fee with PayFast'}</Button></CardContent></Card>
    </div>
  );
}

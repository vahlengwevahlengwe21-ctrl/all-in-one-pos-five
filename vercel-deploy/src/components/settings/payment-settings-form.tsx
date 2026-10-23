'use client';

import { useEffect, useState } from 'react';
import { getShopPaymentSettingsAction, updateShopPaymentSettingsAction } from '@/app/actions/shop-actions';
import { useDoc, useMysql, useUser } from '@/auth';
import { doc } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { PaymentProvider, ShopPaymentSettings, UserProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const providers: Array<{ value: PaymentProvider; label: string; description: string; needsMerchantId: boolean }> = [
  { value: 'manual_terminal', label: 'Any card machine', description: 'Use a Yoco, iKhokha, Nedbank, FNB, Capitec, Standard Bank, or other terminal. Cashier confirms the approved receipt.', needsMerchantId: false },
  { value: 'yoco', label: 'Yoco', description: 'South African terminal workflow. API availability depends on your Yoco merchant account.', needsMerchantId: true },
  { value: 'ikhokha', label: 'iKhokha', description: 'South African terminal workflow. Confirm integration access with iKhokha.', needsMerchantId: true },
  { value: 'snapscan', label: 'SnapScan', description: 'South African QR payment workflow.', needsMerchantId: true },
  { value: 'payfast', label: 'PayFast', description: 'Online payment checkout, not a direct countertop card-machine connection.', needsMerchantId: true },
  { value: 'paystack', label: 'Paystack', description: 'Online payment checkout where supported by your account and region.', needsMerchantId: true },
  { value: 'stripe_terminal', label: 'Stripe Terminal', description: 'Integrated card terminal workflow where Stripe Terminal is available for your business.', needsMerchantId: true },
];

export function PaymentSettingsForm() {
  const { user } = useUser();
  const mysql = useMysql();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const { toast } = useToast();
  const [shopId, setShopId] = useState('');
  const [form, setForm] = useState({ provider: 'manual_terminal' as PaymentProvider, displayName: 'Card machine', merchantId: '', terminalName: '', enabled: true });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user || !profile?.shopId) return;
    user.getSessionProof().then(async (sessionProof) => {
      const result = await getShopPaymentSettingsAction({ sessionProof, shopId: profile.shopId! });
      if (result.success && result.settings) {
        const settings = result.settings as ShopPaymentSettings;
        setShopId(settings.shopId);
        setForm({ provider: settings.provider, displayName: settings.displayName, merchantId: settings.merchantId || '', terminalName: settings.terminalName || '', enabled: settings.enabled });
      }
    });
  }, [user, profile?.shopId]);

  const selectedProvider = providers.find((provider) => provider.value === form.provider) || providers[0];

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !shopId) return;
    setIsSaving(true);
    const result = await updateShopPaymentSettingsAction({ sessionProof: await user.getSessionProof(), shopId, ...form });
    setIsSaving(false);
    toast(result.success ? { title: 'Payment method saved' } : { variant: 'destructive', title: 'Unable to save payment method', description: result.error });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Payments</CardTitle>
        <CardDescription>Tell the POS which payment method your shop uses. All prices and payments are configured in South African rand (ZAR).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="max-w-2xl space-y-5">
          <div className="space-y-2"><Label htmlFor="payment-provider">Payment provider</Label><select id="payment-provider" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as PaymentProvider })}>{providers.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select><p className="text-sm text-muted-foreground">{selectedProvider.description}</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="payment-display-name">Name shown to cashiers</Label><Input id="payment-display-name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Front counter card machine" required /></div><div className="space-y-2"><Label htmlFor="payment-terminal-name">Terminal name or serial</Label><Input id="payment-terminal-name" value={form.terminalName} onChange={(event) => setForm({ ...form, terminalName: event.target.value })} placeholder="Counter 1" /></div></div>
          {selectedProvider.needsMerchantId && <div className="space-y-2"><Label htmlFor="payment-merchant-id">Merchant ID or account reference</Label><Input id="payment-merchant-id" value={form.merchantId} onChange={(event) => setForm({ ...form, merchantId: event.target.value })} placeholder="Provided by your payment provider" /><p className="text-xs text-muted-foreground">Never enter a secret key here. Secret keys belong in the server environment or payment provider vault.</p></div>}
          <div className="flex items-center justify-between rounded-md border p-4"><div><p className="font-medium">Available at checkout</p><p className="text-sm text-muted-foreground">Cashiers can select this method for card payments.</p></div><Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></div>
          <Button type="submit" disabled={isSaving || !shopId}>{isSaving ? 'Saving...' : 'Save payment method'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useAuth, useCollection, useDoc, useMysql, useUser } from '@/auth';
import { collection, doc, query, where } from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { UserProfile } from '@/lib/types';
import type { CashDrawer, Customer, Discount, Layaway, StoreCredit } from '@/lib/types';
import {
  addLoyaltyPointsAction,
  closeCashDrawerAction,
  createDiscountAction,
  createLayawayAction,
  createStoreCreditAction,
  makeLayawayPaymentAction,
  updateCustomerAction,
  openCashDrawerAction,
} from '@/app/actions/advanced-pos-actions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

const money = (value?: number) => `R${(value || 0).toFixed(2)}`;

export function PosOperations() {
  const mysql = useMysql();
  const { user } = useUser();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const auth = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [discountName, setDiscountName] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditCustomerId, setCreditCustomerId] = useState('');
  const [layawayCustomerId, setLayawayCustomerId] = useState('');
  const [layawayProductId, setLayawayProductId] = useState('');
  const [layawayProductName, setLayawayProductName] = useState('');
  const [layawayPrice, setLayawayPrice] = useState('');
  const [layawayQuantity, setLayawayQuantity] = useState('1');
  const [paymentLayawayId, setPaymentLayawayId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingDrawerId, setClosingDrawerId] = useState('');
  const [closingBalance, setClosingBalance] = useState('');

  const shopQuery = (name: string) => mysql && profile?.shopId ? query(collection(mysql, name), where('shopId', '==', profile.shopId)) : null;
  const customersQuery = useMemoMysql(() => shopQuery('customers'), [mysql, profile?.shopId]);
  const discountsQuery = useMemoMysql(() => shopQuery('discounts'), [mysql, profile?.shopId]);
  const creditsQuery = useMemoMysql(() => shopQuery('store_credits'), [mysql, profile?.shopId]);
  const layawaysQuery = useMemoMysql(() => shopQuery('layaways'), [mysql, profile?.shopId]);
  const drawersQuery = useMemoMysql(() => shopQuery('cash_drawers'), [mysql, profile?.shopId]);
  const { data: customers } = useCollection<Customer>(customersQuery);
  const { data: discounts } = useCollection<Discount>(discountsQuery);
  const { data: credits } = useCollection<StoreCredit>(creditsQuery);
  const { data: layaways } = useCollection<Layaway>(layawaysQuery);
  const { data: drawers } = useCollection<CashDrawer>(drawersQuery);

  const withToken = async <T extends { success: boolean; error?: string }>(callback: (sessionProof: string) => Promise<T>) => {
    if (!auth?.currentUser) throw new Error('You must be signed in.');
    const result = await callback(await auth.currentUser.getSessionProof());
    if (!result.success) throw new Error(result.error || 'The operation was not completed.');
    return result;
  };

  const run = async (callback: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await callback();
      toast({ title: success });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Action failed', description: error.message });
    } finally {
      setBusy(false);
    }
  };

  const selectedCustomer = customers?.find((customer) => customer.id === selectedCustomerId);
  const selectedLayaway = layaways?.find((layaway) => layaway.id === paymentLayawayId);
  const openDrawers = drawers?.filter((drawer) => drawer.status === 'open') || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">POS Operations</h1>
        <p className="text-sm text-muted-foreground">Manage customers, promotions, credits, layaways, and tills.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer management</CardTitle>
            <CardDescription>Update contact details or add loyalty points.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedCustomerId} onChange={(event) => {
              const customer = customers?.find((item) => item.id === event.target.value);
              setSelectedCustomerId(event.target.value);
              setCustomerName(customer?.name || '');
              setCustomerPhone(customer?.phone || '');
            }}>
              <option value="">Select a customer</option>
              {customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} {customer.phone ? `(${customer.phone})` : ''}</option>)}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
              <Input placeholder="Phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !selectedCustomerId || !customerName} onClick={() => run(async () => {
                await withToken((sessionProof) => updateCustomerAction({ sessionProof, customerId: selectedCustomerId, name: customerName, phone: customerPhone }));
              }, 'Customer updated')}>Save customer</Button>
              <Input className="w-32" type="number" min="1" placeholder="Points" value={loyaltyPoints} onChange={(event) => setLoyaltyPoints(event.target.value)} />
              <Button variant="outline" disabled={busy || !selectedCustomerId || !loyaltyPoints} onClick={() => run(async () => {
                await withToken((sessionProof) => addLoyaltyPointsAction({ sessionProof, customerId: selectedCustomerId, points: Number(loyaltyPoints) }));
                setLoyaltyPoints('');
              }, 'Loyalty points added')}>Add points</Button>
            </div>
            {selectedCustomer && <p className="text-xs text-muted-foreground">{selectedCustomer.loyaltyPoints || 0} points, {money(selectedCustomer.totalSpent)} spent, {selectedCustomer.visitCount || 0} visits.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create discount</CardTitle>
            <CardDescription>New promotions are immediately available to POS promo validation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Discount name" value={discountName} onChange={(event) => setDiscountName(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={discountType} onChange={(event) => setDiscountType(event.target.value as 'percentage' | 'fixed')}>
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
              <Input type="number" min="0" placeholder="Value" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} />
              <Input placeholder="Promo code (optional)" value={promoCode} onChange={(event) => setPromoCode(event.target.value)} />
            </div>
            <Button disabled={busy || !discountName || !discountValue} onClick={() => run(async () => {
              await withToken((sessionProof) => createDiscountAction({ sessionProof, name: discountName, type: discountType, value: Number(discountValue), promoCode: promoCode || undefined }));
              setDiscountName(''); setDiscountValue(''); setPromoCode('');
            }, 'Discount created')}>Create discount</Button>
            <Separator />
            <div className="space-y-1 text-sm">{discounts?.slice(0, 5).map((discount) => <div className="flex justify-between" key={discount.id}><span>{discount.name}{discount.promoCode ? ` (${discount.promoCode})` : ''}</span><span>{discount.type === 'percentage' ? `${discount.value}%` : money(discount.value)}</span></div>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Store credit</CardTitle>
            <CardDescription>Issue credit or gift cards for use at checkout.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="number" min="0.01" placeholder="Initial amount" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} />
            <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={creditCustomerId} onChange={(event) => setCreditCustomerId(event.target.value)}>
              <option value="">No customer linked</option>
              {customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <Button disabled={busy || !creditAmount} onClick={() => run(async () => {
              await withToken((sessionProof) => createStoreCreditAction({ sessionProof, initialAmount: Number(creditAmount), customerId: creditCustomerId || undefined, type: 'store_credit' }));
              setCreditAmount(''); setCreditCustomerId('');
            }, 'Store credit issued')}>Issue store credit</Button>
            <Separator />
            <div className="space-y-1 text-sm">{credits?.slice(0, 5).map((credit) => <div className="flex justify-between" key={credit.id}><span>{credit.code}</span><span>{money(credit.balance)} {credit.isActive ? '' : '(inactive)'}</span></div>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash drawers</CardTitle>
            <CardDescription>Open a till and close it with the counted balance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2"><Input type="number" min="0" placeholder="Opening balance" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /><Button disabled={busy || !openingBalance} onClick={() => run(async () => {
              await withToken((sessionProof) => openCashDrawerAction({ sessionProof, openingBalance: Number(openingBalance) }));
              setOpeningBalance('');
            }, 'Cash drawer opened')}>Open drawer</Button></div>
            <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={closingDrawerId} onChange={(event) => setClosingDrawerId(event.target.value)}>
              <option value="">Select open drawer</option>
              {openDrawers.map((drawer) => <option key={drawer.id} value={drawer.id}>{drawer.salespersonName} - opened with {money(drawer.openingBalance)}</option>)}
            </select>
            <div className="flex gap-2"><Input type="number" min="0" placeholder="Closing balance" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} /><Button variant="outline" disabled={busy || !closingDrawerId || !closingBalance} onClick={() => run(async () => {
              await withToken((sessionProof) => closeCashDrawerAction({ sessionProof, drawerId: closingDrawerId, closingBalance: Number(closingBalance) }));
              setClosingDrawerId(''); setClosingBalance('');
            }, 'Cash drawer closed')}>Close drawer</Button></div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Layaways</CardTitle>
            <CardDescription>Create a one-line layaway and record payments as the customer pays.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-5">
              <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={layawayCustomerId} onChange={(event) => setLayawayCustomerId(event.target.value)}><option value="">Customer</option>{customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
              <Input placeholder="Product ID" value={layawayProductId} onChange={(event) => setLayawayProductId(event.target.value)} />
              <Input placeholder="Product name" value={layawayProductName} onChange={(event) => setLayawayProductName(event.target.value)} />
              <Input type="number" min="0.01" placeholder="Price" value={layawayPrice} onChange={(event) => setLayawayPrice(event.target.value)} />
              <Input type="number" min="1" placeholder="Qty" value={layawayQuantity} onChange={(event) => setLayawayQuantity(event.target.value)} />
            </div>
            <Button disabled={busy || !layawayCustomerId || !layawayProductId || !layawayProductName || !layawayPrice} onClick={() => run(async () => {
              const customer = customers?.find((item) => item.id === layawayCustomerId);
              await withToken((sessionProof) => createLayawayAction({ sessionProof, customerId: layawayCustomerId, customerName: customer?.name || '', items: [{ productId: layawayProductId, productName: layawayProductName, price: Number(layawayPrice), quantity: Number(layawayQuantity) }] }));
              setLayawayProductId(''); setLayawayProductName(''); setLayawayPrice(''); setLayawayQuantity('1');
            }, 'Layaway created')}>Create layaway</Button>
            <Separator />
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={paymentLayawayId} onChange={(event) => setPaymentLayawayId(event.target.value)}><option value="">Select pending layaway</option>{layaways?.filter((layaway) => layaway.status === 'pending').map((layaway) => <option key={layaway.id} value={layaway.id}>{layaway.customerName} - remaining {money(layaway.remainingAmount)}</option>)}</select>
              <Input type="number" min="0.01" placeholder="Payment" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              <Button variant="outline" disabled={busy || !paymentLayawayId || !paymentAmount || Number(paymentAmount) > (selectedLayaway?.remainingAmount || 0)} onClick={() => run(async () => {
                await withToken((sessionProof) => makeLayawayPaymentAction({ sessionProof, layawayId: paymentLayawayId, paymentAmount: Number(paymentAmount) }));
                setPaymentLayawayId(''); setPaymentAmount('');
              }, 'Layaway payment recorded')}>Record payment</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
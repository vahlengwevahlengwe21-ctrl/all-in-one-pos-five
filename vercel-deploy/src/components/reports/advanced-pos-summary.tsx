'use client';

import { useMemo } from 'react';
import { collection } from '@/lib/mysql-client';
import { useCollection, useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { doc, query, where } from '@/lib/mysql-client';
import type { Layaway, Sale, UserProfile } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSelectedShopContext } from '@/contexts/shop-context';

const money = (value: number) => `R${value.toFixed(2)}`;

export function AdvancedPosSummary() {
  const mysql = useMysql();
  const { user } = useUser();
  const { selectedShopId, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const scopedShopId = isSuperAdmin ? selectedShopId || profile?.shopId : profile?.shopId;
  const salesQuery = useMemoMysql(() => {
    if (!mysql || !profile || !scopedShopId) return null;
    return query(collection(mysql, 'sales'), where('shopId', '==', scopedShopId));
  }, [mysql, profile, scopedShopId]);
  const layawaysQuery = useMemoMysql(() => {
    if (!mysql || !profile || !scopedShopId) return null;
    return query(collection(mysql, 'layaways'), where('shopId', '==', scopedShopId));
  }, [mysql, profile, scopedShopId]);
  const { data: sales, isLoading: salesLoading } = useCollection<Sale>(salesQuery);
  const { data: layaways, isLoading: layawaysLoading } = useCollection<Layaway>(layawaysQuery);

  const summary = useMemo(() => {
    const result = {
      revenue: 0,
      costOfGoods: 0,
      grossProfit: 0,
      discounts: 0,
      cash: 0,
      card: 0,
      credit: 0,
      giftcard: 0,
      customerRevenue: {} as Record<string, number>,
    };
    (sales || []).forEach((sale) => {
      if (sale.status === 'voided') return;
      result.revenue += sale.total || 0;
      result.costOfGoods += sale.costOfGoods || 0;
      result.grossProfit += sale.grossProfit ?? ((sale.total || 0) - (sale.costOfGoods || 0));
      result.discounts += sale.discountTotal || 0;
      const payments = sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod, amount: sale.amountPaid }];
      payments.forEach((payment) => {
        if (payment.method === 'cash') result.cash += payment.amount;
        if (payment.method === 'card') result.card += payment.amount;
        if (payment.method === 'credit') result.credit += payment.amount;
        if (payment.method === 'giftcard') result.giftcard += payment.amount;
      });
      if (sale.customerName) result.customerRevenue[sale.customerName] = (result.customerRevenue[sale.customerName] || 0) + sale.total;
    });
    return result;
  }, [sales]);

  const topCustomers = Object.entries(summary.customerRevenue).sort(([, first], [, second]) => second - first).slice(0, 5);
  const completedLayaways = layaways?.filter((layaway) => layaway.status === 'completed').length || 0;
  const pendingLayaways = layaways?.filter((layaway) => layaway.status === 'pending').length || 0;
  const outstandingLayaways = layaways?.filter((layaway) => layaway.status === 'pending').reduce((sum, layaway) => sum + layaway.remainingAmount, 0) || 0;

  if (salesLoading || layawaysLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading advanced POS summary...</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Net revenue</CardDescription><CardTitle>{money(summary.revenue)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Gross profit</CardDescription><CardTitle>{money(summary.grossProfit)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Discount impact</CardDescription><CardTitle>{money(summary.discounts)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Cash / card</CardDescription><CardTitle>{money(summary.cash)} / {money(summary.card)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Layaway outstanding</CardDescription><CardTitle>{money(outstandingLayaways)}</CardTitle></CardHeader></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Payment method breakdown</CardTitle><CardDescription>Recorded payment totals across completed sales.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Cash</span><strong>{money(summary.cash)}</strong></div>
            <div className="flex justify-between"><span>Card</span><strong>{money(summary.card)}</strong></div>
            <div className="flex justify-between"><span>Store credit</span><strong>{money(summary.credit)}</strong></div>
            <div className="flex justify-between"><span>Gift card</span><strong>{money(summary.giftcard)}</strong></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top customers</CardTitle><CardDescription>Customers ranked by recorded sale value.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {topCustomers.length ? topCustomers.map(([name, total]) => <div className="flex justify-between" key={name}><span>{name}</span><strong>{money(total)}</strong></div>) : <p className="text-muted-foreground">No customer-linked sales yet.</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Layaway completion</CardTitle><CardDescription>Current payment-plan status.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Completed</p><p className="text-2xl font-semibold">{completedLayaways}</p></div><div><p className="text-muted-foreground">Pending</p><p className="text-2xl font-semibold">{pendingLayaways}</p></div><div><p className="text-muted-foreground">Outstanding</p><p className="text-2xl font-semibold">{money(outstandingLayaways)}</p></div></CardContent>
      </Card>
    </div>
  );
}
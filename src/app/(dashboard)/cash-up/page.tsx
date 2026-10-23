'use client';

import { useMemo, type ElementType } from 'react';
import { useDoc, useMysql, useCollection, useMemoMysql, useUser } from '@/auth';
import { collection, doc, query, where } from '@/lib/mysql-client';
import type { Sale, UserProfile } from '@/lib/types';
import { startOfToday, startOfWeek, startOfMonth, endOfToday, endOfWeek, endOfMonth, isWithinInterval } from 'date-fns';
import { Loader2, User, Ban, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useSelectedShopContext } from '@/contexts/shop-context';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface PaymentStats {
  cash: number;
  card: number;
  voids: number;
  total: number;
}

interface PeriodTotals {
  today: PaymentStats;
  thisWeek: PaymentStats;
  thisMonth: PaymentStats;
}

type SalespersonTotals = Record<string, PeriodTotals>;

const emptyStats: PaymentStats = { cash: 0, card: 0, voids: 0, total: 0 };
const createEmptyPeriodTotals = (): PeriodTotals => ({
  today: { ...emptyStats },
  thisWeek: { ...emptyStats },
  thisMonth: { ...emptyStats },
});

const normalizeSalespersonName = (value?: string) => value?.trim() || 'Unknown Salesperson';

const StatDisplay = ({ title, amount }: { title: string; amount: number }) => (
  <div className="flex justify-between items-center text-sm">
    <p className="text-muted-foreground">{title}</p>
    <p className="font-medium">R{amount.toFixed(2)}</p>
  </div>
);

const TotalsCard = ({ title, stats }: { title: string; stats: PaymentStats }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <StatDisplay title="Cash Payments" amount={stats.cash} />
        <StatDisplay title="Card Payments" amount={stats.card} />
      </div>
      <Separator />
      <div className="flex justify-between font-bold text-lg">
        <span>Net Sales</span>
        <span>R{stats.total.toFixed(2)}</span>
      </div>
    </CardContent>
  </Card>
);

const AdjustmentCard = ({ title, amount, icon: Icon }: { title: string; amount: number; icon: ElementType }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <span>{title}</span>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-2xl font-bold">R{amount.toFixed(2)}</p>
      <p className="text-xs text-muted-foreground">Total value for this period</p>
    </CardContent>
  </Card>
);

const PeriodSection = ({ title, stats }: { title: string; stats: PaymentStats }) => (
    <div>
        <h3 className="mb-4 text-xl font-semibold tracking-tight">{title}</h3>
        <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
          <TotalsCard title="Net Sales" stats={stats} />
          <AdjustmentCard title="Voids" amount={stats.voids} icon={Ban} />
        </div>
    </div>
  );

export default function CashUpPage() {
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
  const { data: sales, isLoading: salesLoading } = useCollection<Sale>(salesQuery);
  
  const usersQuery = useMemoMysql(() => {
    if (!mysql || !profile || !scopedShopId) return null;
    return query(collection(mysql, 'users'), where('shopId', '==', scopedShopId));
  }, [mysql, profile, scopedShopId]);
  const { data: users, isLoading: usersLoading } = useCollection<UserProfile>(usersQuery);

  const salespersonTotals: SalespersonTotals = useMemo(() => {
    const initialData: SalespersonTotals = {};

    if (users) {
      users.forEach((user) => {
        const name = normalizeSalespersonName(`${user.name} ${user.surname}`);
        if (user.hiddenFromUserList) {
          return;
        }
        initialData[name] = createEmptyPeriodTotals();
      });
    }

    if (!sales) return initialData;

    const now = new Date();
    const todayInterval = { start: startOfToday(), end: endOfToday() };
    const weekInterval = { start: startOfWeek(now), end: endOfWeek(now) };
    const monthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    return sales.reduce((acc, sale) => {
      const salespersonName = normalizeSalespersonName(sale.salespersonName);

      if (!acc[salespersonName]) return acc;

      if (!sale.createdAt || !sale.createdAt.toDate) return acc;
      const saleDate = sale.createdAt.toDate();

      const processSale = (period: keyof PeriodTotals, interval: { start: Date; end: Date }) => {
        if (!isWithinInterval(saleDate, interval)) return;

        if (sale.status === 'voided') {
          acc[salespersonName][period].voids += sale.total;
          return;
        }

        if (!sale.status || sale.status === 'completed') {
          const payments = sale.payments?.length
            ? sale.payments
            : [{ method: sale.paymentMethod, amount: sale.total }];
          payments.forEach((payment) => {
            if (payment.method === 'cash') {
              acc[salespersonName][period].cash += payment.amount;
            } else if (payment.method === 'card') {
              acc[salespersonName][period].card += payment.amount;
            }
          });
          acc[salespersonName][period].total += sale.total;
        }
      };

      processSale('today', todayInterval);
      processSale('thisWeek', weekInterval);
      processSale('thisMonth', monthInterval);

      return acc;
    }, initialData);
  }, [sales, users]);

  const grandTotals: PeriodTotals = useMemo(() => {
    const totals = createEmptyPeriodTotals();
    Object.values(salespersonTotals).forEach((personTotals) => {
      (Object.keys(totals) as Array<keyof PeriodTotals>).forEach((period) => {
        totals[period].cash += personTotals[period].cash;
        totals[period].card += personTotals[period].card;
        totals[period].voids += personTotals[period].voids;
        totals[period].total += personTotals[period].total;
      });
    });
    return totals;
  }, [salespersonTotals]);

  const isLoading = salesLoading || usersLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }
  
  const sortedSalespersons = Object.keys(salespersonTotals).sort();
  const hasSalespersons = sortedSalespersons.length > 0;

  return (
    <>
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Cash-Up Summary</h1>
      </div>
      <div className="space-y-8 mt-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-4">Per-Salesperson Breakdown</h2>
          {hasSalespersons ? (
            <Accordion type="multiple" className="w-full space-y-4">
              {sortedSalespersons.map((salesperson) => (
                <AccordionItem value={salesperson} key={salesperson} className="border rounded-lg">
                  <AccordionTrigger className="px-6 py-4 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-lg">{salesperson}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-6 pt-0 space-y-8">
                    <PeriodSection title="Today's Summary" stats={salespersonTotals[salesperson].today} />
                    <Separator />
                    <PeriodSection title="This Week's Summary" stats={salespersonTotals[salesperson].thisWeek} />
                    <Separator />
                    <PeriodSection title="This Month's Summary" stats={salespersonTotals[salesperson].thisMonth} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <Card>
              <CardContent className="flex min-h-28 items-center justify-center p-6 text-muted-foreground">
                No sales activity has been recorded yet.
              </CardContent>
            </Card>
          )}
        </div>

        <Separator />

        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Users className="h-6 w-6 text-primary" />
              <span className="text-2xl">Grand Totals (All Salespersons)</span>
            </CardTitle>
            <CardDescription>A combined summary of all sales activity across all staff members.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <PeriodSection title="Today's Grand Total" stats={grandTotals.today} />
            <Separator />
            <PeriodSection title="This Week's Grand Total" stats={grandTotals.thisWeek} />
            <Separator />
            <PeriodSection title="This Month's Grand Total" stats={grandTotals.thisMonth} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

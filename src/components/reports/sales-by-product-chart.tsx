
'use client';

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useCollection, useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collectionGroup, doc, query, where } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import type { SaleItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo, useState, useEffect } from 'react';
import { useSelectedShopContext } from '@/contexts/shop-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';

const chartConfig = {
  quantity: {
    label: 'Quantity Sold',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

const MIN_HEIGHT = 400; // Minimum height for the chart in pixels
const ITEM_HEIGHT = 35; // Height per item in pixels

// Helper to get unique months from sales data
const getUniqueMonths = (items: SaleItem[] | null): string[] => {
  if (!items) return [];
  const monthSet = new Set<string>();
  items.forEach((item) => {
    if (item.createdAt && typeof item.createdAt.toDate === 'function') {
      const date = item.createdAt.toDate();
      monthSet.add(format(date, 'yyyy-MM'));
    }
  });
  return Array.from(monthSet).sort().reverse();
};

export function SalesByProductChart() {
  const mysql = useMysql();
  const { user } = useUser();
  const { selectedShopId, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const scopedShopId = isSuperAdmin ? selectedShopId || profile?.shopId : profile?.shopId;
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  const saleItemsQuery = useMemoMysql(
    () => {
      if (!mysql || !profile || !scopedShopId) return null;
      return query(collectionGroup(mysql, 'items'), where('shopId', '==', scopedShopId));
    },
    [mysql, profile, scopedShopId]
  );
  const { data: saleItems, isLoading } = useCollection<SaleItem>(saleItemsQuery);

  const uniqueMonths = useMemo(() => getUniqueMonths(saleItems), [saleItems]);
  
  useEffect(() => {
    if (uniqueMonths.length > 0 && !selectedMonth) {
        setSelectedMonth(uniqueMonths[0]);
    }
  }, [uniqueMonths, selectedMonth]);

  const chartData = useMemo(() => {
    if (!saleItems || !selectedMonth) {
      return [];
    }

    const filteredItems = saleItems.filter(item => {
        return item.createdAt && typeof item.createdAt.toDate === 'function' && format(item.createdAt.toDate(), 'yyyy-MM') === selectedMonth;
    });

    const salesByProduct = filteredItems.reduce((acc, item) => {
      if (!acc[item.productName]) {
        acc[item.productName] = { name: item.productName, quantity: 0 };
      }
      acc[item.productName].quantity += item.quantity;
      return acc;
    }, {} as Record<string, { name: string; quantity: number }>);

    return Object.values(salesByProduct).sort((a, b) => b.quantity - a.quantity);
  }, [saleItems, selectedMonth]);
  
  const chartHeight = useMemo(() => {
    const numItems = chartData?.length || 0;
    return Math.max(MIN_HEIGHT, numItems * ITEM_HEIGHT);
  }, [chartData]);


  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <CardTitle>Sales by Product</CardTitle>
                <CardDescription>
                Total units sold for each product in the selected month.
                </CardDescription>
            </div>
            <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={isLoading || uniqueMonths.length === 0}>
                <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Select a month" />
                </SelectTrigger>
                <SelectContent>
                    {uniqueMonths.map(month => (
                        <SelectItem key={month} value={month}>
                            {format(new Date(`${month}-02`), 'MMMM yyyy')}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[500px] w-full" />
        ) : !saleItems || saleItems.length === 0 ? (
           <div className="flex h-[500px] w-full items-center justify-center">
            <p className="text-muted-foreground">No sales data found.</p>
          </div>
        ) : chartData.length === 0 && selectedMonth ? (
          <div className="flex h-[500px] w-full items-center justify-center">
            <p className="text-muted-foreground">No sales data found for {format(new Date(`${selectedMonth}-02`), 'MMMM yyyy')}.</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ height: `${chartHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 10, right: 30, top: 10, bottom: 10 }}
              >
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: 'hsl(var(--foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={150}
                  interval={0}
                />
                <XAxis
                  type="number"
                  tick={{ fill: 'hsl(var(--foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}`}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  content={<ChartTooltipContent />}
                />
                <Legend />
                <Bar
                  dataKey="quantity"
                  fill="var(--color-quantity)"
                  radius={[4, 4, 0, 0]}
                  layout="vertical"
                >
                    <LabelList dataKey="quantity" position="right" offset={8} style={{ fill: 'hsl(var(--foreground))' }} fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

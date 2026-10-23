'use client';

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
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
import { useCollection, useMysql, useDoc, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collection, query, doc, where } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import type { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo } from 'react';

const chartConfig = {
  stock: {
    label: 'Stock',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

const MIN_HEIGHT = 400; // Minimum height for the chart in pixels
const ITEM_HEIGHT = 35; // Height per item in pixels

export function InventoryChart() {
  const mysql = useMysql();
  const { user } = useUser();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const productsQuery = useMemoMysql(
    () => (mysql && profile?.shopId ? query(collection(mysql, 'products'), where('shopId', '==', profile.shopId)) : null),
    [mysql, profile?.shopId]
  );
  const { data: products, isLoading } = useCollection<Product>(productsQuery);

  const chartData = useMemo(() => {
    if (!products) return [];
    return products.filter((product) => !product.isArchived)
      .map((product) => ({
        name: product.name,
        stock: product.stock,
      }))
      .sort((a, b) => a.stock - b.stock); // Sort ascending to have lowest at the bottom
  }, [products]);

  const chartHeight = useMemo(() => {
    const numItems = chartData?.length || 0;
    return Math.max(MIN_HEIGHT, numItems * ITEM_HEIGHT);
  }, [chartData]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Levels</CardTitle>
        <CardDescription>
          Current stock quantity for each product.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[500px] w-full" />
        ) : !chartData || chartData.length === 0 ? (
          <div className="flex h-[500px] w-full items-center justify-center">
            <p className="text-muted-foreground">No inventory data found.</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ height: `${chartHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 10, right: 40, top: 10, bottom: 20 }} // Adjusted margins
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
                  label={{ value: 'Quantity', position: 'insideBottom', offset: -10, style: { fill: 'hsl(var(--foreground))' } }}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  content={<ChartTooltipContent />}
                />
                <Bar
                  dataKey="stock"
                  fill="var(--color-stock)"
                  radius={[0, 4, 4, 0]}
                  layout="vertical"
                >
                  <LabelList
                    dataKey="stock"
                    position="right"
                    offset={8}
                    style={{ fill: 'hsl(var(--foreground))' }}
                    fontSize={12}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

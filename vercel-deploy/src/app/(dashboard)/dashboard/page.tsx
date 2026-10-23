'use client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { InventoryTable } from '@/components/dashboard/inventory-table';
import { Package, Archive, AlertCircle, CheckCircle, TrendingUp, WalletCards } from 'lucide-react';
import { useCollection, useMysql, useDoc, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collection, query, doc, where } from '@/lib/mysql-client';
import type { UserProfile } from '@/lib/types';
import type { Product, Sale } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useSelectedShopContext } from '@/contexts/shop-context';

export default function Dashboard() {
  const mysql = useMysql();
  const { user } = useUser();
  const { selectedShopId, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const scopedShopId = isSuperAdmin ? selectedShopId || profile?.shopId : profile?.shopId;
  const productsQuery = useMemoMysql(
    () => (mysql && scopedShopId ? query(collection(mysql, 'products'), where('shopId', '==', scopedShopId)) : null),
    [mysql, scopedShopId]
  );
  const { data: products, isLoading } = useCollection<Product>(productsQuery);
  const salesQuery = useMemoMysql(
    () => (mysql && scopedShopId ? query(collection(mysql, 'sales'), where('shopId', '==', scopedShopId)) : null),
    [mysql, scopedShopId]
  );
  const { data: sales, isLoading: isLoadingSales } = useCollection<Sale>(salesQuery);

  const activeProducts = products?.filter((product) => !product.isArchived);
  const totalItems = activeProducts?.length ?? 0;
  const inStockItems =
    activeProducts?.filter((p) => p.status === 'In Stock').length ?? 0;
  const lowStockItems =
    activeProducts?.filter((p) => p.status === 'Low Stock').length ?? 0;
  const outOfStockItems =
    activeProducts?.filter((p) => p.status === 'Out of Stock').length ?? 0;
  const revenue = sales?.filter((sale) => sale.status !== 'voided').reduce((sum, sale) => sum + (sale.total || 0), 0) || 0;
  const grossProfit = sales?.filter((sale) => sale.status !== 'voided').reduce((sum, sale) => sum + (sale.grossProfit ?? ((sale.total || 0) - (sale.costOfGoods || 0))), 0) || 0;
  const lowStockValue = activeProducts?.filter((product) => product.status === 'Low Stock').reduce((sum, product) => sum + (product.costPrice || 0) * product.stock, 0) || 0;
  const money = (value: number) => `R${value.toFixed(2)}`;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Products
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-1/4" />
            ) : (
              <div className="text-2xl font-bold">{totalItems}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Unique products in catalog
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Stock</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-1/4" />
            ) : (
              <div className="text-2xl font-bold">{inStockItems}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Products with healthy stock levels
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertCircle className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-1/4" />
            ) : (
              <div className="text-2xl font-bold text-accent">
                {lowStockItems}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Products needing reorder
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <Archive className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-1/4" />
            ) : (
              <div className="text-2xl font-bold text-destructive">
                {outOfStockItems}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Unavailable products
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Shop Revenue</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{isLoadingSales ? '...' : money(revenue)}</div><p className="text-xs text-muted-foreground">All non-voided sales</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Gross Profit</CardTitle><WalletCards className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{isLoadingSales ? '...' : money(grossProfit)}</div><p className="text-xs text-muted-foreground">Revenue less recorded product cost</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Low Stock Cost</CardTitle><AlertCircle className="h-4 w-4 text-accent" /></CardHeader><CardContent><div className="text-2xl font-bold">{money(lowStockValue)}</div><p className="text-xs text-muted-foreground">Estimated reorder value</p></CardContent></Card>
      </div>
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Inventory Overview</CardTitle>
            <CardDescription>
              A list of all products in your inventory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InventoryTable products={activeProducts || null} isLoading={isLoading} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

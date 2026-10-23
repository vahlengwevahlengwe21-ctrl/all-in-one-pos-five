'use client';

import { useMemo, useState } from 'react';
import { collection, doc, query, where } from '@/lib/mysql-client';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { useCollection, useDoc, useMysql, useUser } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import type { Product, SaleItem, UserProfile } from '@/lib/types';
import { useSelectedShopContext } from '@/contexts/shop-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardList, ExternalLink, PackageSearch, RefreshCw, ShoppingBasket } from 'lucide-react';

type ReportProduct = Product & { size?: string; sizeVariant?: string; unitLabel?: string; leadTimeDays?: number };
type GroupKey = 'groceries' | 'beer' | 'cider' | 'wine' | 'brandy' | 'other';
type GroupedProduct = ReportProduct & { soldUnits: number; salesValue: number; sizeLabel: string; dailyVelocity: number; daysRemaining: number | null; restockLevel: 'critical' | 'monitor' | 'comfortable' };

const GROUPS: Record<GroupKey, { label: string; description: string; color: string }> = {
  groceries: { label: 'Groceries & staples', description: 'Everyday essentials that bring regular customers into the shop. Watch availability closely because an empty shelf can send a customer elsewhere.', color: '#0f766e' },
  beer: { label: 'Beer', description: 'High-volume stock that usually drives daily cash flow. Compare pack formats separately so cases do not hide fast-selling single units.', color: '#d97706' },
  cider: { label: 'Cider & coolers', description: 'Ready-to-drink products with strong weekend movement. Keep the exact can, bottle, and multipack format visible when ordering.', color: '#db2777' },
  wine: { label: 'Wine', description: 'A mixed portfolio where boxed, sweet, dry, and sparkling formats behave differently. Group the category, but keep each size clear.', color: '#7c3aed' },
  brandy: { label: 'Brandy & spirits', description: 'Higher-value lines that need disciplined stock control. Size and bottle format matter because margins and customer demand can differ sharply.', color: '#b91c1c' },
  other: { label: 'Other products', description: 'Products that do not match the main retail groups. Review these lines to improve category naming and reporting.', color: '#475569' },
};

const categoryFor = (product: ReportProduct): GroupKey => {
  const value = `${product.category} ${product.name}`.toLowerCase();
  if (/brandy|cognac|whisky|whiskey|vodka|gin|rum|spirit/.test(value)) return 'brandy';
  if (/cider|cooler|savanna|hunters|flying fish/.test(value)) return 'cider';
  if (/beer|lager|stout|ale|pilsner|castle|amstel|heineken|black label/.test(value)) return 'beer';
  if (/wine|ros[eé]|chardonnay|merlot|shiraz|cabernet|box wine/.test(value)) return 'wine';
  if (/grocery|groceries|bread|milk|maize|meal|sugar|oil|rice|flour|soap|soft drink|soda|household/.test(value)) return 'groceries';
  return 'other';
};

const dateValue = (createdAt: SaleItem['createdAt']) => {
  if (!createdAt) return 0;
  if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
  if (typeof createdAt.toDate === 'function') return createdAt.toDate().getTime();
  return new Date(createdAt).getTime();
};

const money = (value: number) => `R${value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AdvancedReport() {
  const mysql = useMysql();
  const { user } = useUser();
  const { selectedShopId, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const scopedShopId = isSuperAdmin ? selectedShopId || profile?.shopId : profile?.shopId;
  const productsQuery = useMemoMysql(() => {
    if (!mysql || !profile || !scopedShopId) return null;
    return query(collection(mysql, 'products'), where('shopId', '==', scopedShopId));
  }, [mysql, profile, scopedShopId]);
  const saleItemsQuery = useMemoMysql(() => {
    return null;
  }, []);
  const { data: products, isLoading: productsLoading } = useCollection<ReportProduct>(productsQuery);
  const { data: saleItems, isLoading: salesLoading } = useCollection<SaleItem>(saleItemsQuery);
  const [activeGroup, setActiveGroup] = useState<GroupKey>('groceries');
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const soldByProduct = new Map<string, { units: number; value: number }>();
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    (saleItems || []).forEach((item) => {
      if (dateValue(item.createdAt) < since) return;
      const current = soldByProduct.get(item.productId) || { units: 0, value: 0 };
      current.units += item.quantity || 0;
      current.value += (item.quantity || 0) * (item.price || 0);
      soldByProduct.set(item.productId, current);
    });
    const result: Record<GroupKey, GroupedProduct[]> = { groceries: [], beer: [], cider: [], wine: [], brandy: [], other: [] };
    (products || []).filter((product) => !product.isArchived).forEach((product) => {
      const sold = soldByProduct.get(product.id) || { units: 0, value: 0 };
      const sizeLabel = product.sizeVariant || product.size || product.unitLabel || (product.containedUnits ? `${product.containedUnits} units per pack` : 'Standard unit');
      const dailyVelocity = sold.units / 30;
      const daysRemaining = dailyVelocity > 0 ? product.stock / dailyVelocity : null;
      const leadTimeDays = product.leadTimeDays || 2;
      const restockLevel = product.stock === 0 || (daysRemaining !== null && daysRemaining <= leadTimeDays) || product.stock <= product.threshold
        ? 'critical'
        : daysRemaining !== null && daysRemaining <= leadTimeDays + 3
          ? 'monitor'
          : 'comfortable';
      result[categoryFor(product)].push({ ...product, sizeLabel, soldUnits: sold.units, salesValue: sold.value, dailyVelocity, daysRemaining, restockLevel });
    });
    Object.values(result).forEach((items) => items.sort((a, b) => b.salesValue - a.salesValue || a.name.localeCompare(b.name)));
    return result;
  }, [products, saleItems]);

  const items = grouped[activeGroup];
  const overviewData = (Object.keys(GROUPS) as GroupKey[])
    .map((key) => ({ name: GROUPS[key].label, value: grouped[key].reduce((sum, item) => sum + (item.salesValue || item.stock * item.price || 0), 0), color: GROUPS[key].color }))
    .filter((item) => item.value > 0);
  const chartData = items.map((item) => ({ name: `${item.name} · ${item.sizeLabel}`, value: item.salesValue || item.stock * item.price || 0, color: GROUPS[activeGroup].color }));
  const totalSales = items.reduce((sum, item) => sum + item.salesValue, 0);
  const totalCost = items.reduce((sum, item) => sum + item.stock * (item.costPrice || 0), 0);
  const lowStock = items.filter((item) => item.restockLevel !== 'comfortable');
  const loading = productsLoading || salesLoading;
  const quantityFor = (item: GroupedProduct) => orderQuantities[item.id] ?? String(Math.max(item.threshold * 2 - item.stock, item.threshold || 1));

  const sendWhatsAppOrder = () => {
    if (!lowStock.length) return;
    const lines = lowStock.map((item, index) => `${index + 1}. *${item.name}*\n   Size/format: ${item.sizeLabel}\n   Required quantity: *${quantityFor(item)}*`);
    const message = `*SPAZA POS STOCK QUOTE REQUEST*\nCategory: ${GROUPS[activeGroup].label}\nDate: ${new Date().toLocaleDateString('en-ZA')}\n\nPlease quote your best price for these exact quantities:\n\n${lines.join('\n\n')}\n\nPlease include availability, delivery fee, and expected delivery time.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  if (loading) return <Skeleton className="h-[620px] w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Business report</h1><p className="mt-1 text-sm text-muted-foreground">A clear view of what is selling, what it earns, and what needs ordering. Sales movement uses the last 30 days.</p></div><Badge variant="outline" className="gap-2"><RefreshCw className="h-3.5 w-3.5" />Live shop data</Badge></div>
      <div className="flex flex-wrap gap-2">{(Object.keys(GROUPS) as GroupKey[]).map((key) => <Button key={key} variant={activeGroup === key ? 'default' : 'outline'} size="sm" onClick={() => { setActiveGroup(key); setOrderQuantities({}); }}>{GROUPS[key].label}</Button>)}</div>
      <Card><CardHeader><CardTitle>Whole-store revenue mix</CardTitle><CardDescription>Each slice is a business group. Select a group above to inspect its brands, sizes, margins, and restock lines.</CardDescription></CardHeader><CardContent><div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-center">{overviewData.length ? <div className="h-[230px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={overviewData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={92} paddingAngle={3}>{overviewData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip formatter={(value: number) => money(value)} /></PieChart></ResponsiveContainer></div> : <div className="flex h-[230px] items-center justify-center text-sm text-muted-foreground">No revenue mix data yet.</div>}<div className="grid gap-3 sm:grid-cols-2">{overviewData.map((entry) => <button type="button" key={entry.name} className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => setActiveGroup((Object.keys(GROUPS) as GroupKey[]).find((key) => GROUPS[key].label === entry.name) || 'other')}><span className="flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />{entry.name}</span><strong className="text-sm">{money(entry.value)}</strong></button>)}</div></div></CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
        <Card><CardHeader><CardTitle>{GROUPS[activeGroup].label}</CardTitle><CardDescription>Round contribution view by product and size</CardDescription></CardHeader><CardContent>{chartData.length ? <div className="h-[290px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={78} outerRadius={112} paddingAngle={3}>{chartData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={index % 2 ? '#f59e0b' : entry.color} />)}</Pie><Tooltip formatter={(value: number) => money(value)} /></PieChart></ResponsiveContainer></div> : <div className="flex h-[290px] items-center justify-center text-sm text-muted-foreground">No sales or stock value to graph yet.</div>}<div className="grid grid-cols-2 gap-4 border-t pt-4 text-sm"><div><p className="text-muted-foreground">30-day sales</p><p className="text-xl font-semibold">{money(totalSales)}</p></div><div><p className="text-muted-foreground">Stock at cost</p><p className="text-xl font-semibold">{money(totalCost)}</p></div></div></CardContent></Card>
        <Card><CardHeader><CardTitle>What this group means</CardTitle><CardDescription>{GROUPS[activeGroup].description}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4"><ShoppingBasket className="h-5 w-5 text-primary" /><div><p className="font-medium">{items.length} product lines tracked</p><p className="text-sm text-muted-foreground">Each line keeps its own brand, size, and packaging format.</p></div></div><div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4"><PackageSearch className="h-5 w-5 text-destructive" /><div><p className="font-medium">{lowStock.length} lines need attention</p><p className="text-sm text-muted-foreground">Low stock means current quantity is at or below the product threshold.</p></div></div><p className="text-sm leading-6 text-muted-foreground">Use the exact size shown below when comparing suppliers. A 750ml bottle, 440ml can, 6-pack, 5kg bag, and single unit must remain separate order lines even when they belong to the same group.</p></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Grouped product ledger</CardTitle><CardDescription>Brand, size, sales velocity, and supplier timing stay visible so the report is easy to act on.</CardDescription></CardHeader><CardContent><div className="space-y-3">{items.length ? items.map((item) => { const margin = item.price > 0 && item.costPrice !== undefined ? ((item.price - item.costPrice) / item.price) * 100 : null; const statusLabel = item.restockLevel === 'critical' ? 'CRITICAL RESTOCK' : item.restockLevel === 'monitor' ? 'MONITOR STOCK' : 'COMFORTABLE'; const statusClass = item.restockLevel === 'critical' ? 'text-destructive' : item.restockLevel === 'monitor' ? 'text-amber-600' : 'text-emerald-700'; return <div key={item.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1.35fr)_120px_110px_120px] md:items-center"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sizeLabel} · {item.soldUnits} sold in 30 days</p></div><div><p className="text-xs text-muted-foreground">Restock radar</p><p className={`font-semibold ${statusClass}`}>{statusLabel}</p><p className="text-xs text-muted-foreground">{item.daysRemaining === null ? 'No recent sales' : `${item.daysRemaining.toFixed(1)} days left`}</p></div><div><p className="text-xs text-muted-foreground">Stock</p><p className="font-semibold">{item.stock} / {item.threshold} min</p><p className="text-xs text-muted-foreground">{item.dailyVelocity.toFixed(1)} per day</p></div><div>{margin === null ? <span className="text-xs text-muted-foreground">Cost not set</span> : <><p className="text-xs text-muted-foreground">Gross margin</p><p className="font-medium">{margin.toFixed(1)}%</p></>}</div></div> }) : <p className="py-8 text-center text-sm text-muted-foreground">No products in this group yet.</p>}</div></CardContent></Card>
      {lowStock.length > 0 && <Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-destructive" />Restock and supplier quote</CardTitle><CardDescription>Change the required quantity, then open WhatsApp to send this exact list to your current supplier or compare another supplier.</CardDescription></CardHeader><CardContent className="space-y-3">{lowStock.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sizeLabel} · {item.stock} currently available</p></div><div className="flex items-center gap-2"><label htmlFor={`order-${item.id}`} className="text-sm text-muted-foreground">Order</label><Input id={`order-${item.id}`} type="number" min="0" value={quantityFor(item)} onChange={(event) => setOrderQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24" /></div></div>)}<Button onClick={sendWhatsAppOrder} className="w-full sm:w-auto"><ExternalLink className="mr-2 h-4 w-4" />Send exact quote request on WhatsApp</Button></CardContent></Card>}
    </div>
  );
}
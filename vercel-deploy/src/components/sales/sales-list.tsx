'use client';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, useDoc, useMysql, useUser, useAuth } from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collection, query, orderBy, doc, limit, where } from '@/lib/mysql-client';
import type { Sale, SaleItem, UserProfile } from '@/lib/types';
import { format } from 'date-fns';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Ban, Loader2, Search, RotateCcw } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Input } from '../ui/input';
import { useToast } from '@/hooks/use-toast';
import { returnSaleAction, voidSaleAction } from '@/app/actions/sale-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Textarea } from '../ui/textarea';

function SaleDetails({ sale, isAdmin }: { sale: Sale; isAdmin: boolean }) {
  const mysql = useMysql();
  const auth = useAuth();
  const { toast } = useToast();
  const [isVoiding, setIsVoiding] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card'>('cash');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const itemsQuery = useMemoMysql(
    () =>
      mysql
        ? query(collection(mysql, `sales/${sale.id}/items`))
        : null,
    [mysql, sale.id]
  );
  const { data: items, isLoading } = useCollection<SaleItem>(itemsQuery);

  const returnsQuery = useMemoMysql(
    () =>
      mysql
        ? query(collection(mysql, `sales/${sale.id}/returns`))
        : null,
    [mysql, sale.id]
  );
  const { data: returns } = useCollection<any>(returnsQuery);

  const handleVoidSale = async () => {
    setIsVoiding(true);

    if (!auth || !auth.currentUser) {
       toast({
        variant: 'destructive',
        title: 'Authentication Error',
        description: 'You must be logged in to perform this action.',
      });
      setIsVoiding(false);
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setIsVoiding(false);
      return;
    }

    const sessionProof = await currentUser.getSessionProof();

    const result = await voidSaleAction({ saleId: sale.id, sessionProof, reason });
    setIsVoiding(false);

    if (result?.success) {
      setVoidDialogOpen(false);
      setReason('');
      toast({
        title: 'Sale Voided',
        description: `Sale ${sale.id.substring(
          0,
          7
        )} has been successfully voided.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Void Failed',
        description: result?.error || 'An unknown error occurred.',
      });
    }
  };

  const handleReturnSale = async () => {
    if (!auth?.currentUser || !items) return;
    setIsReturning(true);
    try {
      const sessionProof = await auth.currentUser.getSessionProof();
      const result = await returnSaleAction({
        saleId: sale.id,
        sessionProof,
        reason,
        refundMethod,
        items: Object.entries(returnQuantities).map(([itemId, quantity]) => ({ itemId, quantity })),
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Return processed', description: 'Inventory and the refund record have been updated.' });
      setReturnDialogOpen(false);
      setReason('');
      setReturnQuantities({});
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Return failed', description: error.message });
    } finally {
      setIsReturning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  return (
    <div className="px-4 py-2 bg-muted/50 rounded-md space-y-4">
      {!items || items.length === 0 ? (
        <p className="p-4 text-muted-foreground">No items found for this sale.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-center">Quantity</TableHead>
              <TableHead className="text-center text-xs text-muted-foreground">Returned</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const returned = item.returnedQuantity || 0;
              return (
                <TableRow key={item.id} className={returned > 0 ? 'bg-muted/30' : ''}>
                  <TableCell className="font-medium">{item.productName}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell className="text-center text-sm">
                    {returned > 0 ? (
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                        -{returned}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    R{item.price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    R{(item.quantity * item.price).toFixed(2)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Separator />
      {returns && returns.length > 0 && (
        <>
          <div className="p-2">
            <h3 className="font-semibold text-sm mb-3">Return History</h3>
            <div className="space-y-3 text-sm">
              {returns.map((ret, idx) => (
                <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium text-orange-900">
                        {ret.items?.map((ri: any) => {
                          const item = items?.find((i) => i.id === ri.itemId);
                          return item ? `${ri.quantity}x ${item.productName}` : `Item ${ri.itemId}`;
                        }).join(', ')}
                      </div>
                      <div className="text-xs text-orange-700 mt-1">
                        Reason: {ret.reason || 'N/A'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-orange-900">R{ret.refundAmount.toFixed(2)}</div>
                      <div className="text-xs text-orange-700">{ret.refundMethod}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ret.createdAt ? new Date(ret.createdAt.seconds * 1000).toLocaleString() : 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Separator />
        </>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm p-2">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">R{sale.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-medium">R{sale.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t mt-2">
            <span className="font-bold">Total</span>
            <span className="font-bold">R{sale.total.toFixed(2)}</span>
          </div>
          {sale.returnedTotal ? (
            <div className="flex justify-between text-muted-foreground">
              <span>Refunded</span>
              <span>R{sale.returnedTotal.toFixed(2)}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount Paid</span>
            <span className="font-medium">R{sale.amountPaid.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Change Due</span>
            <span className="font-medium">R{sale.changeDue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payment Method</span>
            <Badge variant="secondary" className="capitalize">
              {sale.paymentMethod}
            </Badge>
          </div>
        </div>
      </div>
      {isAdmin && (
        <div className="p-2 border-t mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={(e) => { e.stopPropagation(); setVoidDialogOpen(true); }}
            disabled={sale.status === 'voided' || isVoiding || sale.status === 'refunded'}
          >
            {isVoiding ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="mr-2 h-3.5 w-3.5" />
            )}
            Void This Sale
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-2 h-8"
            onClick={(e) => { e.stopPropagation(); setReturnDialogOpen(true); }}
            disabled={sale.status === 'voided' || sale.status === 'refunded' || !items?.length || isReturning}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Process Return
          </Button>
        </div>
      )}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Void sale</DialogTitle>
            <DialogDescription>This reverses the full sale and restores inventory. A reason is required.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for voiding" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoidSale} disabled={isVoiding || !reason.trim()}>
              {isVoiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Process return</DialogTitle>
            <DialogDescription>Select quantities to return. Inventory will be restored and the refund recorded.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="bg-muted p-3 rounded-md text-sm space-y-2">
              <div className="font-semibold">Return Summary</div>
              {items?.map((item) => {
                const available = item.quantity - (item.returnedQuantity || 0);
                const returningQty = returnQuantities[item.id] || 0;
                const itemRefund = returningQty * item.price;
                return (
                  <div key={item.id} className="text-xs space-y-1">
                    <div className="font-medium">{item.productName}</div>
                    <div className="grid grid-cols-2 gap-2 ml-2 text-muted-foreground">
                      <div>Available: <span className="font-medium text-foreground">{available}</span></div>
                      <div>Unit: <span className="font-medium text-foreground">R{item.price.toFixed(2)}</span></div>
                      <div>Returning: <span className="font-medium text-foreground">{returningQty}</span></div>
                      {returningQty > 0 && <div>Refund: <span className="font-medium text-green-600">R{itemRefund.toFixed(2)}</span></div>}
                    </div>
                  </div>
                );
              })}
              <div className="border-t pt-2 mt-2 font-semibold flex justify-between">
                <span>Total Refund:</span>
                <span className="text-green-600">R{Object.entries(returnQuantities).reduce((sum, [itemId, qty]) => {
                  const item = items?.find(i => i.id === itemId);
                  return sum + (qty * (item?.price || 0));
                }, 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-3 border-t pt-3">
              {items?.map((item) => {
                const available = item.quantity - (item.returnedQuantity || 0);
                return (
                  <div key={item.id} className="flex items-end justify-between gap-3">
                    <div className="flex-1 text-sm">{item.productName}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">of {available}</span>
                      <Input
                        type="number"
                        min={0}
                        max={available}
                        value={returnQuantities[item.id] || ''}
                        onChange={(e) => setReturnQuantities((current) => ({ ...current, [item.id]: Math.min(available, Math.max(0, Number(e.target.value) || 0)) }))}
                        className="w-16 text-center"
                        disabled={available === 0}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return" className="mt-3" />
          <select className="h-10 rounded-md border bg-background px-3" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'card')}>
            <option value="cash">Refund in cash</option>
            <option value="card">Refund to card</option>
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleReturnSale} disabled={isReturning || !reason.trim() || !Object.values(returnQuantities).some((quantity) => quantity > 0)}>
              {isReturning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaleAccordionItem({ sale, isAdmin }: { sale: Sale, isAdmin: boolean }) {
  const mysql = useMysql();
  
  const saleItemsQuery = useMemoMysql(() => (
      mysql ? query(collection(mysql, `sales/${sale.id}/items`)) : null
  ), [mysql, sale.id]);
  
  const { data: items } = useCollection(saleItemsQuery);
  const itemCount = items?.length ?? 0;

  return (
    <AccordionItem value={sale.id} key={sale.id}>
      <AccordionTrigger className="hover:no-underline p-4">
        <div className="grid grid-cols-4 md:grid-cols-5 gap-4 w-full text-sm text-left">
          <div className="font-medium">
            {sale.createdAt
              ? format(sale.createdAt.toDate(), 'yyyy-MM-dd HH:mm')
              : 'N/A'}
          </div>
          <div className="text-muted-foreground">{sale.salespersonName}</div>
          <div className="font-semibold text-right">
            R{sale.total.toFixed(2)}
          </div>
          <div className="hidden md:block text-right text-muted-foreground">
            {itemCount} item(s)
          </div>
           <div className="flex justify-end">
            {sale.status === 'voided' && <Badge variant="destructive">Voided</Badge>}
            {sale.status === 'partially_refunded' && <Badge variant="secondary">Partially Refunded</Badge>}
            {sale.status === 'refunded' && <Badge variant="destructive">Refunded</Badge>}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <SaleDetails sale={sale} isAdmin={isAdmin} />
      </AccordionContent>
    </AccordionItem>
  );
}

export function SalesList() {
  const mysql = useMysql();
  const { user } = useUser();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | NonNullable<Sale['status']>>('all');
  const userProfileRef = useMemoMysql(
    () => (mysql && user ? doc(mysql, 'users', user.uid) : null),
    [mysql, user]
  );
  const { data: userProfile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const salesQuery = useMemoMysql(
    () => mysql && userProfile?.shopId && userProfile.role !== 'super administrator'
      ? query(collection(mysql, 'sales'), where('shopId', '==', userProfile.shopId), orderBy('createdAt', 'desc'), limit(50))
      : null,
    [mysql, userProfile]
  );
  const { data: sales, isLoading: isLoadingSales } = useCollection<Sale>(salesQuery);

  const isAdmin =
    userProfile?.role === 'shop owner' ||
    userProfile?.role === 'super administrator';
  const isLoading = isLoadingSales || isProfileLoading;
  
  const filteredSales = useMemo(() => {
    if (!sales) return [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return sales.filter((sale) => {
      const matchesSearch = !normalizedSearch || [sale.id, sale.salespersonName, sale.customerName, sale.paymentReference].some((value) => value?.toLowerCase().includes(normalizedSearch));
      const matchesStatus = statusFilter === 'all' || (sale.status || 'completed') === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [sales, searchTerm, statusFilter]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales History</CardTitle>
        <CardDescription>
          A log of all completed transactions. Click a sale to view its items.
        </CardDescription>
         <div className="relative pt-2">
            <Search className="absolute left-2.5 top-4 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sale ID, cashier, customer, or card reference..."
                className="pl-8 w-full md:w-1/3 lg:w-1/4"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={isLoading}
            />
              <select aria-label="Filter sales by status" className="mt-3 h-10 rounded-md border bg-background px-3 text-sm md:ml-3 md:mt-0" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="completed">Completed</option><option value="partially_refunded">Partially refunded</option><option value="refunded">Refunded</option><option value="voided">Voided</option></select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 p-4 border rounded-md">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
             <div className="grid grid-cols-4 md:grid-cols-5 gap-4 w-full text-sm font-semibold px-4 py-2 border-b">
              <div>Date</div>
              <div>Salesperson</div>
              <div className="text-right">Total</div>
              <div className="hidden md:block text-right">Items</div>
              <div className="text-right">Status</div>
            </div>
            {filteredSales.map((sale) => (
              <SaleAccordionItem key={sale.id} sale={sale} isAdmin={isAdmin}/>
            ))}
            {filteredSales.length === 0 && !isLoading && (
              <div className="text-center p-8 text-muted-foreground">
                {searchTerm ? `No sales found for ID "${searchTerm}"` : "No sales have been recorded yet."}
              </div>
            )}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}



'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useCollection, useMysql, useUser, useDoc, useAuth } from '@/auth';
import {
  collection,
  query,
  doc,
  Timestamp,
  where,
} from '@/lib/mysql-client';
import { useMemoMysql } from '@/auth/provider';
import type { PaymentProvider, Product, Sale, Shop, UserProfile } from '@/lib/types';
import { PosProductList } from './pos-product-list';
import { PosCart } from './pos-cart';
import { createSaleAction } from '@/app/actions/sale-actions';
import { getShopPaymentSettingsAction, getShopProfileAction } from '@/app/actions/shop-actions';
import { useToast } from '@/hooks/use-toast';
import { Barcode, Printer, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useReactToPrint } from 'react-to-print';
import { SaleReceipt } from './sale-receipt';
import { Button } from '../ui/button';
import { CustomerLookup } from './customer-lookup';
import { QuickAccess } from './quick-access';
import { CustomerForm } from './customer-form';
import type { Customer } from '@/lib/types';
import { StockAlertBanner, type StockAlertItem } from './stock-alert-banner';

export type CartItem = {
  product: Product;
  quantity: number;
  price: number;
};

type CompletedSale = {
  details: Sale;
  items: CartItem[];
};

type HeldCart = {
  id: string;
  label: string;
  items: CartItem[];
  customer: Customer | null;
  createdAt: number;
};

export function PosClientPage() {
  const mysql = useMysql();
  const { user } = useUser();
  const auth = useAuth();
  const userProfileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: userProfile, isLoading: isLoadingProfile } = useDoc<UserProfile>(userProfileRef);
  const [shop, setShop] = useState<Shop | null>(null);
  const [cardProvider, setCardProvider] = useState<PaymentProvider>('manual_terminal');
  const [stockAlerts, setStockAlerts] = useState<StockAlertItem[]>([]);
  const { toast } = useToast();
  const productsQuery = useMemoMysql(
    () => {
      if (!mysql) return null;
      return userProfile?.shopId
        ? query(collection(mysql, 'products'), where('shopId', '==', userProfile.shopId))
        : null;
    },
    [mysql, userProfile?.shopId]
  );
  const { data: products, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);
  const activeProducts = products?.filter((product) => !product.isArchived);

  useEffect(() => {
    if (!user || !userProfile?.shopId) return;
    user.getSessionProof().then(async (sessionProof) => {
      const result = await getShopProfileAction({ sessionProof, shopId: userProfile.shopId! });
      if (result.success) setShop(result.shop as Shop);
      const paymentSettings = await getShopPaymentSettingsAction({ sessionProof, shopId: userProfile.shopId! });
      if (paymentSettings.success && paymentSettings.settings?.enabled) setCardProvider(paymentSettings.settings.provider as PaymentProvider);
    });
  }, [user, userProfile?.shopId]);


  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessingSale, setIsProcessingSale] = useState(false);
  const [scannedSku, setScannedSku] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [lastCompletedSale, setLastCompletedSale] = useState<CompletedSale | null>(null);
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [cartSession, setCartSession] = useState(0);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef(null);

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    onAfterPrint: () => setLastCompletedSale(null),
  });

  const addToCart = useCallback(
    (product: Product, price: number) => {
      setCart((currentCart) => {
        const existingItem = currentCart.find(
          (item) => item.product.id === product.id
        );
        if (existingItem) {
          if (existingItem.quantity < product.stock) {
            return currentCart.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + 1 }
                : item
            );
          } else {
            toast({
              variant: 'destructive',
              title: 'Out of Stock',
              description: `No more stock available for ${product.name}.`,
            });
            return currentCart;
          }
        }
        if (product.stock > 0) {
          return [...currentCart, { product, quantity: 1, price: price || 0 }];
        } else {
          toast({
            variant: 'destructive',
            title: 'Out of Stock',
            description: `${product.name} is currently out of stock.`,
          });
          return currentCart;
        }
      });
    },
    [toast]
  );

  const processScan = useCallback(
    (sku: string) => {
      const normalizedSku = sku.trim();
      if (!normalizedSku || !products) return;

      const product = activeProducts?.find((p) => p.sku === normalizedSku);
      if (product) {
        addToCart(product, product.price || 0);
      } else {
        toast({
          variant: 'destructive',
          title: 'Product not found',
          description: `No product with SKU "${normalizedSku}" was found.`,
        });
      }
      setScannedSku(''); // Clear the input field's state
      requestAnimationFrame(() => scanInputRef.current?.focus());
    },
    [activeProducts, addToCart, toast]
  );

  useEffect(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    if (scannedSku) {
      scanTimeoutRef.current = setTimeout(() => {
        processScan(scannedSku);
      }, 100); // Wait 100ms after the last keystroke to process
    }
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, [scannedSku, processScan]);

  const updateCartItem = (productId: string, updates: Partial<CartItem>) => {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.product.id === productId ? { ...item, ...updates } : item
      )
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((currentCart) =>
      currentCart.filter((item) => item.product.id !== productId)
    );
  };

  const handleCancelSale = () => {
    if (cart.length > 0) {
      setIsCancelling(true);
    }
  };

  const handleClearCart = () => {
    setCart([]);
    setIsCancelling(false);
    toast({
      title: 'Cart Cleared',
      description: 'The current sale has been cancelled.',
    });
  };

  const holdCurrentCart = () => {
    if (!cart.length) return;
    const label = window.prompt('Name this held sale:', `Customer ${heldCarts.length + 1}`)?.trim();
    if (!label) return;
    setHeldCarts((current) => [...current, { id: crypto.randomUUID(), label, items: cart, customer: selectedCustomer, createdAt: Date.now() }]);
    setCart([]);
    setSelectedCustomer(null);
    setCartSession((current) => current + 1);
    toast({ title: 'Sale held', description: `${label} is waiting in Held Sales.` });
  };

  const resumeHeldCart = (heldCart: HeldCart) => {
    if (cart.length) {
      toast({ variant: 'destructive', title: 'Current sale is active', description: 'Complete, cancel, or hold the current sale before resuming another one.' });
      return;
    }
    setCart(heldCart.items);
    setSelectedCustomer(heldCart.customer);
    setCartSession((current) => current + 1);
    setHeldCarts((current) => current.filter((item) => item.id !== heldCart.id));
    toast({ title: 'Sale resumed', description: heldCart.label });
  };

  const completeSale = async (
    saleDetails: Omit<
      Sale,
      'id' | 'createdAt' | 'salespersonId' | 'salespersonName'
    >
  ) => {
    if (!mysql || !user || !userProfile) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Database not connected or user not logged in.',
      });
      return;
    }
    if (cart.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cart is empty',
        description: 'Add items to the cart to complete a sale.',
      });
      return;
    }

    setIsProcessingSale(true);

    try {
      const currentUser = auth?.currentUser;
      if (!currentUser) throw new Error('Authentication is not ready. Please sign in again.');
      const sessionProof = await currentUser.getSessionProof(false);
      const result = await createSaleAction({
        sessionProof,
        sale: { ...saleDetails, shopId: userProfile.shopId },
        items: cart.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          price: item.price,
          baseProductSku: item.product.baseProductSku || item.product.sku,
          containedUnits: item.product.containedUnits || 1,
        })),
      });
      if (!result.success || !result.saleId) throw new Error(result.error || 'Unable to complete sale.');
      await window.electronAPI?.recordSaleTime?.();
      const finalSaleData: Sale = {
        ...saleDetails,
        id: result.saleId,
        createdAt: Timestamp.now(),
        salespersonId: user.uid,
        salespersonName: `${userProfile.name} ${userProfile.surname}`,
      };

      const completedSaleItems = [...cart];
      const alerts = completedSaleItems
        .map((item) => ({ name: item.product.name, size: item.product.sizeVariant || (item.product.containedUnits ? `${item.product.containedUnits} units per pack` : 'Standard unit'), stock: item.product.stock - item.quantity, threshold: item.product.threshold }))
        .filter((item) => item.stock <= item.threshold);
      setStockAlerts(alerts);
      setCart([]);
      
      if (finalSaleData) {
        setLastCompletedSale({ details: finalSaleData, items: completedSaleItems });
      }

      toast({
        title: 'Sale Complete!',
        description: 'The inventory has been updated and the sale has been recorded.',
      });

    } catch (error: any) {
      console.error('Sale failed:', error);
      const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined;
      const canQueueOffline = Boolean(electronApi?.saveOfflineSale && typeof navigator !== 'undefined' && !navigator.onLine);
      if (canQueueOffline && electronApi?.saveOfflineSale && auth?.currentUser) {
        try {
          const idempotencyKey = crypto.randomUUID();
          await electronApi.saveOfflineSale({
            idempotencyKey,
            sessionProof: await auth.currentUser.getSessionProof(false),
            sale: { ...saleDetails, shopId: userProfile.shopId },
            items: cart.map((item) => ({
              productId: item.product.id,
              productName: item.product.name,
              quantity: item.quantity,
              price: item.price,
              baseProductSku: item.product.baseProductSku || item.product.sku,
              containedUnits: item.product.containedUnits || 1,
            })),
          });
          await electronApi.recordSaleTime?.();
          setCart([]);
          toast({
            title: 'Sale Saved Offline',
            description: 'The sale is stored locally and will sync when the connection returns.',
          });
          return;
        } catch (offlineError) {
          console.error('Offline sale save failed:', offlineError);
        }
      }
      toast({
        variant: 'destructive',
        title: 'Sale Failed',
        description:
          error.message || 'An unknown error occurred during the sale.',
      });
    } finally {
      setIsProcessingSale(false);
    }
  };

  const isLoading = isLoadingProducts || isLoadingProfile;

  return (
    <>
      <div className="flex flex-col gap-4">
        <StockAlertBanner items={stockAlerts} ownerPhone={shop?.phone} />
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold md:text-2xl">Point of Sale</h1>
          <div className='flex items-center gap-2'>
            <Button variant="outline" onClick={holdCurrentCart} disabled={!cart.length || isProcessingSale} title="Hold the current sale"><PauseCircle className="mr-2 h-4 w-4" />Hold Sale</Button>
            {heldCarts.length > 0 && <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">{heldCarts.map((heldCart) => <Button key={heldCart.id} variant="ghost" size="sm" onClick={() => resumeHeldCart(heldCart)} title={`Resume ${heldCart.label}`}><PlayCircle className="mr-1 h-4 w-4" />{heldCart.label}</Button>)}<Button variant="ghost" size="icon" onClick={() => setHeldCarts([])} title="Clear held sales"><Trash2 className="h-4 w-4" /></Button></div>}
            <Button
                variant="outline"
                onClick={handlePrint}
                disabled={!lastCompletedSale && cart.length === 0}
                >
                <Printer className="mr-2 h-4 w-4" />
                Print Last Receipt
            </Button>
            <div className="relative w-full max-w-sm">
                <Barcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                ref={scanInputRef}
                placeholder="Scan SKU..."
                className="pl-8"
                value={scannedSku}
                onChange={(e) => setScannedSku(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (scanTimeoutRef.current) {
                      clearTimeout(scanTimeoutRef.current);
                      scanTimeoutRef.current = null;
                    }
                    processScan(e.currentTarget.value);
                  }
                }}
                disabled={isLoading}
                autoFocus
                />
            </div>
          </div>
        </div>
        <div className="grid gap-4 lg:h-[calc(100vh-12rem)] lg:min-h-0 lg:grid-cols-[1fr_450px]">
          <PosProductList
            products={activeProducts || null}
            isLoading={isLoading}
            onAddToCart={addToCart}
          />
          <div className="flex flex-col gap-4">
            <QuickAccess
              onAddToCart={(productId) => {
                const product = activeProducts?.find((p) => p.id === productId);
                if (product) addToCart(product, product.price || 0);
              }}
            />
            <PosCart
              key={cartSession}
              cart={cart}
              onUpdateCartItem={updateCartItem}
              onRemoveFromCart={removeFromCart}
              onCompleteSale={completeSale}
              isProcessingSale={isProcessingSale}
              onCancelSale={handleCancelSale}
              customer={selectedCustomer}
              onSelectCustomer={() => setCustomerLookupOpen(true)}
              cardProvider={cardProvider}
            />
          </div>
        </div>
      </div>
      <AlertDialog
        open={isCancelling}
        onOpenChange={setIsCancelling}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will clear all items from the current cart. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCart}>
              Yes, Cancel Sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CustomerLookup
        open={customerLookupOpen}
        onOpenChange={setCustomerLookupOpen}
        onSelectCustomer={(customer) => {
          setSelectedCustomer(customer);
          toast({
            title: 'Customer Selected',
            description: `${customer.name} has been added to this sale.`,
          });
        }}
        onCreateNew={() => {
          setCustomerFormOpen(true);
        }}
      />

      <CustomerForm
        open={customerFormOpen}
        onOpenChange={setCustomerFormOpen}
        onCreated={setSelectedCustomer}
      />

      <div className="hidden">
        {(lastCompletedSale || cart.length > 0) && (
          <SaleReceipt
            ref={receiptRef}
            sale={(lastCompletedSale?.details) as Sale}
            items={lastCompletedSale?.items || cart}
            shop={shop}
          />
        )}
      </div>
    </>
  );
}

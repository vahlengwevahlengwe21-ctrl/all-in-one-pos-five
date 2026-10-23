'use client';
import Image from 'next/image';
import Link from 'next/link';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, Edit, Search, ArchiveRestore } from 'lucide-react';
import {
  useCollection,
  useMysql,
  updateDocumentNonBlocking,
  useUser,
} from '@/auth';
import { useMemoMysql } from '@/auth/provider';
import { collection, query, doc, where } from '@/lib/mysql-client';
import { useDoc } from '@/auth';
import type { UserProfile } from '@/lib/types';
import type { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { useSelectedShopContext } from '@/contexts/shop-context';

export default function ProductsPage() {
  const mysql = useMysql();
  const { user, isUserLoading } = useUser();
  const { selectedShopId, isSuperAdmin } = useSelectedShopContext();
  const profileRef = useMemoMysql(() => (mysql && user ? doc(mysql, 'users', user.uid) : null), [mysql, user]);
  const { data: profile } = useDoc<UserProfile>(profileRef);
  const scopedShopId = isSuperAdmin ? selectedShopId || profile?.shopId : profile?.shopId;
  const productsQuery = useMemoMysql(() => {
    if (!mysql || !profile) return null;
    return scopedShopId ? query(collection(mysql, 'products'), where('shopId', '==', scopedShopId)) : null;
  }, [mysql, profile, scopedShopId]);
  const { data: products, isLoading } = useCollection<Product>(productsQuery);
  const { toast } = useToast();

  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Product['status']>('all');
  const [showArchived, setShowArchived] = useState(false);

  const handleDeleteClick = (product: Product) => {
    setProductToDelete(product);
  };

  const handleConfirmDelete = () => {
    if (productToDelete && mysql && user) {
      const productRef = doc(mysql, 'products', productToDelete.id);
      updateDocumentNonBlocking(productRef, { isArchived: true });
      toast({
        title: 'Product Deleted',
        description: `"${productToDelete.name}" has been archived and will remain available in historical reports.`,
      });
      setProductToDelete(null);
    } else {
       toast({
        variant: 'destructive',
        title: 'Authentication Error',
        description: 'You must be logged in to delete a product.',
      });
    }
  };

  const handleRestore = (product: Product) => {
    if (!mysql) return;
    updateDocumentNonBlocking(doc(mysql, 'products', product.id), { isArchived: false });
    toast({ title: 'Product restored', description: `${product.name} is active in the catalog again.` });
  };

  const pageIsLoading = isLoading || isUserLoading;
  const filteredProducts = products?.filter((product) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = !normalizedSearch || [product.name, product.sku, product.category, product.location].some((value) => value?.toLowerCase().includes(normalizedSearch));
    return product.isArchived === showArchived && matchesSearch && (statusFilter === 'all' || product.status === statusFilter);
  });

  return (
    <>
      <div className="flex flex-col gap-4 lg:gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold md:text-2xl">Product Catalog</h1>
          <Button asChild>
            <Link href="/products/add">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Product
            </Link>
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, SKU, category, or location" className="pl-9" /></div>
          <select aria-label="Filter products by stock status" className="h-10 rounded-md border bg-background px-3 text-sm sm:w-48" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All stock statuses</option><option value="In Stock">In stock</option><option value="Low Stock">Low stock</option><option value="Out of Stock">Out of stock</option></select>
          <Button type="button" variant={showArchived ? 'default' : 'outline'} onClick={() => setShowArchived((current) => !current)}>{showArchived ? 'Active products' : 'Archived products'}</Button>
        </div>
        {pageIsLoading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="p-0">
                  <Skeleton className="aspect-video w-full rounded-t-lg" />
                </CardHeader>
                <CardContent className="space-y-2 p-4">
                  <Skeleton className="h-6 w-3/4" />
                  <div className="flex justify-between">
                    <Skeleton className="h-5 w-1/4" />
                    <Skeleton className="h-5 w-1/4" />
                  </div>
                  <Skeleton className="h-10 w-full" />
                </CardContent>
                <CardFooter className='gap-2'>
                  <Skeleton className="h-9 w-9" />
                  <Skeleton className="h-9 w-9" />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProducts?.map((product) => {
            const placeholder = PlaceHolderImages.find(
              (p) => p.id === product.imageId
            );
            return (
              <Card key={product.id} className="flex flex-col">
                <CardHeader className="p-0">
                  {product.imageUrl ? (
                    <Image
                      alt={product.name}
                      className="aspect-video w-full rounded-t-lg object-cover"
                      height={300}
                      src={product.imageUrl}
                      width={400}
                    />
                  ) : placeholder ? (
                    <Image
                      alt={product.name}
                      className="aspect-video w-full rounded-t-lg object-cover"
                      height={300}
                      src={placeholder.imageUrl}
                      width={400}
                      data-ai-hint={placeholder.imageHint}
                    />
                  ) : (
                    <Skeleton className="aspect-video w-full rounded-t-lg" />
                  )}
                </CardHeader>
                <CardContent className="flex-1 space-y-2 p-4">
                  <CardTitle className="text-lg">{product.name}</CardTitle>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <Badge variant="outline">{product.category}</Badge>
                    <span className="font-mono">{product.sku}</span>
                  </div>
                  <CardDescription>{product.description}</CardDescription>
                  <div className="grid grid-cols-3 gap-2 border-t pt-3 text-sm"><div><p className="text-xs text-muted-foreground">Price</p><p className="font-semibold">R{product.price.toFixed(2)}</p></div><div><p className="text-xs text-muted-foreground">Stock</p><p className="font-semibold">{product.stock}</p></div><div><p className="text-xs text-muted-foreground">Location</p><p className="truncate font-semibold" title={product.location}>{product.location}</p></div></div>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                   <Button variant="outline" size="icon" asChild>
                    <Link href={`/products/edit/${product.id}`}>
                      <Edit className="h-4 w-4" />
                      <span className="sr-only">Edit {product.name}</span>
                    </Link>
                  </Button>
                  {showArchived ? <Button variant="outline" size="icon" onClick={() => handleRestore(product)} disabled={!user}><ArchiveRestore className="h-4 w-4" /><span className="sr-only">Restore {product.name}</span></Button> : <Button variant="destructive" size="icon" onClick={() => handleDeleteClick(product)} disabled={!user}><Trash2 className="h-4 w-4" /><span className="sr-only">Archive {product.name}</span></Button>}
                </CardFooter>
              </Card>
            );
          })}
        </div>
        {!pageIsLoading && filteredProducts?.length === 0 && <Card><CardContent className="flex min-h-32 items-center justify-center p-6 text-sm text-muted-foreground">No products match the current search and filter.</CardContent></Card>}
      </div>
      <AlertDialog
        open={!!productToDelete}
        onOpenChange={(open) => !open && setProductToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              product "{productToDelete?.name}" from the active catalog. Historical sales will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

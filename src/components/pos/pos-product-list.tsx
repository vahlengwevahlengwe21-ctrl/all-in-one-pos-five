'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Star } from 'lucide-react';
import type { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/auth';
import { addFavoriteAction } from '@/app/actions/advanced-pos-actions';
import { useToast } from '@/hooks/use-toast';

interface PosProductListProps {
  products: Product[] | null;
  isLoading: boolean;
  onAddToCart: (product: Product, price: number) => void;
}

export function PosProductList({
  products,
  isLoading,
  onAddToCart,
}: PosProductListProps) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const auth = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (products) {
      const initialPrices = products.reduce((acc, product) => {
        acc[product.id] = product.price || 0;
        return acc;
      }, {} as Record<string, number>);
      setPrices(initialPrices);
    }
  }, [products]);

  const addFavorite = async (product: Product) => {
    if (!auth?.currentUser) return;
    try {
      const sessionProof = await auth.currentUser.getSessionProof();
      const result = await addFavoriteAction({
        sessionProof,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
      });
      if (!result.success) throw new Error(result.error || 'Unable to add favorite.');
      toast({ title: 'Favorite added', description: `${product.name} is now in Quick Favorites.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Favorite failed', description: error.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[calc(100vh-16rem)]">
          {isLoading && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...Array(8)].map((_, i) => (
                <Card key={i}>
                  <CardHeader className="p-0">
                    <Skeleton className="aspect-video w-full rounded-t-lg" />
                  </CardHeader>
                  <CardContent className="space-y-2 p-4">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-5 w-1/4" />
                  </CardContent>
                  <CardFooter>
                    <Skeleton className="h-9 w-full" />
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {products?.map((product) => {
              const placeholder = PlaceHolderImages.find(
                (p) => p.id === product.imageId
              );
              return (
                <Card
                  key={product.id}
                  className={`flex flex-col ${product.stock <= 0 ? 'bg-muted opacity-60 grayscale' : ''}`}
                >
                  <CardHeader className="p-0 relative">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-2 top-2 z-10 h-8 w-8"
                      onClick={() => addFavorite(product)}
                      aria-label={`Add ${product.name} to favorites`}
                    >
                      <Star className="h-4 w-4" />
                    </Button>
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
                    <CardTitle className="text-lg leading-tight">
                      {product.name}
                    </CardTitle>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="w-full"
                      onClick={() => onAddToCart(product, prices[product.id] ?? product.price ?? 0)}
                      disabled={product.stock <= 0}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add to Cart
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
